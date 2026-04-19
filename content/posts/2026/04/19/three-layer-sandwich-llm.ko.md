---
title: "M4 MacBook에서 3.2B LLM을 구동하는 삼층 샌드위치 아키텍처"
date: 2026-04-19T00:00:00+09:00
tags: [llm, mlx, apple-silicon, m4, bit-axon]
---

## 들어가며

MacBook Air M4에 16GB 통합 메모리가 달려있다. PyTorch로 3B 모델을 학습시키면 몇 분 안에 팬이 돌아가고, 무팬 모델에서는 서멀 스로틀링이 걸린다. [Bit-Axon](https://github.com/skyoo2003/bit-axon)은 이 제약을 아키텍처 단에서 해결한 3.2B 파라미터 하이브리드 언어 모델이다.

핵심 아이디어는 **삼층 샌드위치 구조**다: 24개 레이어를 세 구간으로 나누어 각각 다른 연산 방식을 적용한다.

```
Layer  1-8:  ████████████████████ Pure Axon-SSM        → 문맥 흡수 (O(1) 메모리)
Layer  9-16: ███████████████████ SWA + MoE             → 심층 추론 (O(n) 어텐션)
Layer 17-24: ██████████████████ SSM + MoE              → 출력 합성 (선형 + 희소)
```

이 구조는 단순한 직관적 분할이 아니다. Transformer 아키텍처가 직면한 세 가지 근본적인 한계 — **제곱 복잡도, 메모리 폭발, 연산 밀도** — 에 대해 각 구간이 다른 해결책을 제시한다. 이 포스트에서는 각 레이어 그룹의 수학적 기초부터 MLX 프레임워크 최적화, 서멀 인식 학습까지, MacBook에서 LLM을 구동하는 전체 설계를 살펴본다.

## 왜 PyTorch가 아닌 MLX인가?

Apple Silicon에서 MLX를 선택한 이유는 단순하다 — **통합 메모리를 제대로 활용할 수 있는 유일한 프레임워크**이기 때문이다.

| 특징 | PyTorch (MPS) | MLX |
|------|--------------|-----|
| 메모리 배치 | GPU → CPU 복사 필요 | 통합 메모리 제로카피 |
| 컴파일 | `torch.compile` (베타) | `@mx.compile` (안정) |
| Apple Silicon 최적화 | 범용 백엔드 | 네이티브 최적화 |
| SwiftUI 연동 | 불가 | 네이티브 앱 가능 |

PyTorch의 MPS 백엔드는 Apple Silicon GPU를 지원하지만, 여전히 GPU와 CPU 사이에 메모리 복사가 발생한다. 16GB 통합 메모리를 가진 MacBook Air에서 이 복사 오버헤드는 치명적이다 — 텐서를 CPU에서 GPU로 복사할 때마다 메모리 대역폭을 소모하고, 추론 지연시간이 증가한다.

반면 MLX는 Apple의 통합 메모리 아키텍처에 직접 설계되었다. CPU와 GPU가 물리적으로 동일한 메모리를 공유하므로, 텐서 이동이 필요 없다. `@mx.compile` 데코레이터는 성능 크리티컬한 커널을 Apple Silicon GPU에 네이티브로 컴파일하여, PyTorch MPS 백엔드보다 일관되게 빠른 성능을 제공한다.

```
PyTorch (MPS):         MLX:
┌─────────┐            ┌─────────┐
│  CPU    │ ← copy →  │  CPU    │
│ Memory  │            │         │
└─────────┘            │ Unified │
┌─────────┐            │ Memory  │
│  GPU    │ ← copy →  │         │
│ Memory  │            │  GPU    │
└─────────┘            └─────────┘
```

이 차이는 4-bit 양자화된 3.2B 모델에서 극적으로 나타난다. PyTorch는 모델 가중치를 로드할 때 CPU 메모리에 먼저 배치한 다음 GPU로 복사해야 하므로 순간적으로 두 배의 메모리가 필요하다. MLX는 한 번만 할당하면 끝난다.

## 삼층 아키텍처: 설계 철학

샌드위치 아키텍처를 이해하려면 먼저 **왜 이 분할인가**를 이해해야 한다.

Transformer의 핵심 문제는 어텐션의 O(n²) 복잡도다. 시퀀스 길이가 4K에서 64K로 늘어나면, 어텐션 연산량은 256배 증가한다. State Space Model(SSM)은 이 문제를 O(n)으로 해결하지만, 어텐션만큼의 복잡한 의존성을 모델링하지 못한다는 단점이 있다.

Bit-Axon의 접근은 **두 가지 패러다임의 장점을 계층적으로 결합**하는 것이다:

- **문맥 흡수(SSM)**: 64K 토큰을 읽어들일 때 선형 복잡도가 필수적. 어텐션으로 64K 토큰을 처리하는 것은 16GB 메모리에서 불가능하다.
- **심층 추론(SWA + MoE)**: 의미적 관계, 인과 추론, 복잡한 패턴 매칭에는 어텐션이 필요하지만, 전체 시퀀스가 아니라 로컬 윈도우만 보면 충분하다.
- **출력 합성(SSM + MoE)**: 최종 토큰 생성에서는 이미 추론이 완료된 표현을 합성하는 것이므로, SSM의 선형 연산으로 충분하다. MoE는 전문가 지식을 선택적으로 적용하여 품질을 높인다.

이 설계는 각 레이어 그룹에 **최소한의 복잡도**를 할당하는 원칙을 따른다. 어텐션이 필요한 곳에만 어텐션을 두고, 나머지는 더 가벼운 SSM으로 처리한다.

```python
@staticmethod
def _get_layer_type(layer_idx: int, total_layers: int) -> str:
    third = total_layers // 3  # 각 8개 레이어
    if layer_idx < third:           # Layer 0-7: 순수 SSM
        return "ssm"
    elif layer_idx < 2 * third:     # Layer 8-15: SWA + MoE
        return "swa_moe"
    else:                           # Layer 16-23: SSM + MoE
        return "ssm_moe"
```

## Layer 1-8: Pure Axon-SSM (문맥 흡수)

첫 8개 레이어는 순수 Mamba 스타일 **State Space Model(SSM)**이다. 어텐션이 없기 때문에 KV 캐시가 필요 없고, 토큰당 메모리가 O(1)로 고정된다. 이것이 64K 컨텍스트를 처리할 수 있는 이유다.

### SSM의 수학적 기초

SSM은 연속 시간 상태 공간 모델에서 출발한다:

```
h'(t) = Ah(t) + Bx(t)    (상태 방정식)
y(t)  = Ch(t) + Dx(t)     (출력 방정식)
```

여기서 `x(t)`는 입력, `h(t)`는 상태 벡터, `y(t)`는 출력, `A/B/C/D`는 학습 가능한 파라미터 행렬이다. 연속 시간 모델을 이산화하면:

```
h_t = Āh_{t-1} + B̄x_t
y_t = Ch_t + Dx_t
```

이산화는 **Zero-Order Hold (ZOH)** 방식으로 수행되며, `dt` (step size)가 학습 가능한 파라미터다. 이 `dt`가 토큰마다 다른 값을 가질 수 있다는 점이 Mamba의 핵심 혁신이다 — 입력에 따라 상태 업데이트 속도가 조절된다.

### AxonSSM 구현 상세

```python
class AxonSSM(nn.Module):
    def __init__(self, config: BitAxonConfig):
        self.in_proj = nn.Linear(D, 2 * E, bias=False)          # 입력을 x와 z 브랜치로 분할
        self.conv1d = nn.Conv1d(E, E, kernel_size=d_conv, groups=E)  # 깊이별 인과 컨볼루션
        self.x_proj = nn.Linear(E, d_state * 2 + 1, bias=False)   # B, C, dt 파라미터로 투영
        self.dt_proj = nn.Linear(1, E, bias=True)                # 채널별 스텝 사이즈
        self.out_proj = nn.Linear(E, D, bias=False)              # 출력 투영
        self.A_log = mx.log(mx.arange(1, d_state + 1))            # 대각선 SSM 상태 행렬
        self.D = mx.ones((E,))                                    # 스킵 연결 파라미터
```

핵심 컴포넌트 설계 결정:

- **`A_log` 초기화**: `log(1), log(2), ..., log(d_state)`으로 초기화하여 `A = -exp(A_log)`는 음수 대각선 행렬이 된다. 이는 상태가 시간에 따라 지수적으로 감쇠하도록 보장하여 수치적 안정성을 제공한다.
- **인과 컨볼루션 (`conv1d`)**: 커널 사이즈 4의 1D 컨볼루션으로 로컬 문맥을 먼저 추출한다. 이것은 "최근 4개 토큰의 패턴을 먼저 보고, 그 다음 SSM 상태에 반영"하는 직관과 일치한다.
- **게이팅**: `z` 브랜치는 SiLU 활성화로 정보 흐름을 제어한다. `y = SiLU(z) * SSM(x)` 형태로, SSM 출력에 선택적으로 가중치를 부여한다.

### 병렬 스캔 알고리즘

순차적 순환 `h_t = Āh_{t-1} + B̄x_t`은 O(n)이지만 순차적이어서 병렬화가 불가능해 보인다. Mamba의 핵심 혁신은 이를 **연관 스캔(associative scan)**으로 병렬화하는 것이다.

Bit-Axon은 이를 청크 기반으로 구현한다:

```python
def _ssm_scan_parallel(self, x, dt, B_in, C_in):
    step = config.ssm_scan_step  # 기본값 64
    for j in range(d_state):     # 상태 차원별로 독립 처리
        for i in range(0, L, step):
            S = min(step, L - i)
            dtA_chunk = dtA[:, i : i + S, :]
            dtx_chunk = dtx[:, i : i + S, :]
            B_chunk = B_in[:, i : i + S, j]
            C_chunk = C_in[:, i : i + S, j]
```

청크 사이즈 64는 Apple Silicon GPU의 워프 크기와 메모리 계산 균형에 최적화된 값이다. 너무 작으면 커널 런치 오버헤드가 크고, 너무 크면 메모리 사용량이 증가한다.

### 세그먼트 합 최적화

병렬 스캔의 핵심 연산인 세그먼트 합(`segsum`)은 MLX에 네이티브로 컴파일된다:

```python
def segsum(x: mx.array) -> mx.array:
    """하드웨어 효율적인 병렬 세그먼트 합"""
    seq_len = x.shape[-1]
    cs = mx.cumsum(x, axis=-1)
    diff = cs[..., :, None] - cs[..., None, :]
    mask = mx.tril(mx.ones((seq_len, seq_len), dtype=diff.dtype), -1)
    return diff * mask
```

이 연산은 `@mx.compile`로 컴파일되어 Apple Silicon GPU에서 네이티브로 실행된다.

## Layer 9-16: SWA + MoE (심층 추론)

중간 8개 레이어는 **Sliding Window Attention(SWA)**과 **Mixture of Experts(MoE)**를 결합한다. 이 구간이 모델의 **추론 능력**을 담당한다.

### Sliding Window Attention

표준 어텐션은 모든 토큰 쌍에 대해 점곱을 계산하여 O(n²) 복잡도를 가진다. SWA는 각 토큰이 이전 `window_size`개 토큰만 참조하도록 제한하여 O(n × window_size)로 줄인다.

```python
def _make_sliding_window_mask(self, seq_len: int, kv_len: int, q_offset: int = 0):
    q_pos = mx.arange(q_offset, q_offset + seq_len)
    k_pos = mx.arange(kv_len)

    # 인과 제약: 미래 토큰을 볼 수 없음
    causal_mask = k_pos[None, :] <= (q_pos[:, None] + causal_offset)

    # 윈도우 제약: 제한된 어텐션 범위
    window_mask = (q_pos[:, None] + causal_offset) - k_pos[None, :] < self.window_size

    # 결합: 인과+윈도우 밖의 위치는 -inf
    mask = mx.where(causal_mask & window_mask, 0.0, -mx.inf)
```

윈도우 사이즈 4096은 정확히 의도된 선택이다. 대부분의 자연어 의존성은 4K 토큰 내에서 해결된다 — 더 긴 거리의 의존성은 이미 Layer 1-8의 SSM이 처리했다. 따라서 SWA는 "SSM이 흡수한 문맥 위에 로컬 정제를 수행"하는 역할을 한다.

### KV 캐시 트리밍

SWA의 핵심 메모리 최적화는 KV 캐시 트리밍이다:

```python
class KVCache:
    def __init__(self, window_size: int | None = None):
        self.window_size = window_size

    def update_and_fetch(self, xk: mx.array, xv: mx.array) -> tuple[mx.array, mx.array]:
        self.k = mx.concatenate([self.k, xk], axis=2)
        self.v = mx.concatenate([self.v, xv], axis=2)
        if self.window_size is not None:
            self.k = self.k[:, :, -self.window_size:]  # 윈도우로 트리밍
            self.v = self.v[:, :, -self.window_size:]
```

이것이 64K 시퀀스를 처리하면서도 메모리가 O(window_size)로만 증가하는 이유다. 윈도우 밖의 KV 캐시는 버려진다 — SWA가 참조하지 않으므로 정보 손실이 없다.

### Mixture of Experts 구현

MoE는 토큰마다 전문가(expert)를 동적으로 선택하여 연산을 희소화(sparse)한다:

```python
class SharedExpertMoE(nn.Module):
    def __call__(self, x: mx.array) -> mx.array:
        gates = self.gate(x)                      # (batch, seq_len, num_experts)
        gates = mx.softmax(gates, axis=-1)        # 전문가별 소프트맥스

        # Top-k 전문가 선택
        inds = mx.stop_gradient(mx.argpartition(-gates, kth=k-1, axis=-1)[..., :k])
        scores = mx.take_along_axis(gates, inds, axis=-1)

        # 전문가 처리
        y = self.switch_mlp(x, inds)
        y = (y * scores[..., None]).sum(axis=-2)  # 가중치 합산
```

**`gather_mm` 최적화**가 핵심이다. 전문가 라우팅은 수학적으로는 "각 토큰에 대해 선택된 전문가의 가중치 행렬과 곱셈"이지만, 이를 그대로 구현하면 모든 전문가의 가중치를 메모리에 올려야 한다.

```python
class SwitchLinear(nn.Module):
    def __call__(self, x: mx.array, indices: mx.array) -> mx.array:
        B, L, K = indices.shape
        flat_idx = indices.reshape(-1)
        x_flat = x.reshape(-1, 1, D)

        w_t = self.weight.swapaxes(-1, -2)
        out = mx.gather_mm(x_flat, w_t, rhs_indices=flat_idx,
                          sorted_indices=sorted_indices)
```

`mx.gather_mm`은 MLX의 네이티브 연산으로, **인덱스를 기반으로 가중치 행렬의 해당 행만 수집하여 곱셈**을 수행한다. 전체 가중치 행렬을 순회할 필요 없이, 각 토큰이 할당된 전문가의 행만 계산한다. 정렬된 인덱스(`sorted_indices`)를 사용하면 메모리 접근 패턴이 연속적이 되어 캐시 효율이 극대화된다.

**공유 전문가(Shared Expert)**는 모든 토큰에 적용되는 추가 MLP다:

```python
# 공유 전문가 게이팅
shared_out = self.shared_expert(x)
gate = sigmoid(shared_expert_gate(x))
output = gated_expert_output + gate * shared_out
```

공유 전문가가 존재하는 이유는 Top-2 라우팅이 놓칠 수 있는 **공통 지식을 보장**하기 위함이다. "자연어의 기본 문법"이나 "일반적인 세계 지식" 같은 것은 전문가 라우팅에 의존하지 않고 항상 적용되어야 한다.

### 파라미터 활성화 효율

8개 전문가 중 Top-2만 활성화하므로, MoE FFN 파라미터 중 25%만 연산에 참여한다. 공유 전문가까지 포함해도 토큰당 활성화 파라미터는 약 1.4B로, 전체 3.2B의 44%에 불과하다.

## Layer 17-24: SSM + MoE (출력 합성)

마지막 8개 레이어는 어텐션을 완전히 제거하고 SSM + MoE로 구성된다. 선형 순환과 희소 전문가만으로 **빠른 출력 생성**을 수행한다.

```python
class AxonSSMMoEBlock(nn.Module):
    def __call__(self, x, cache=None):
        # SSM with residual
        residual = x
        x = self.input_norm(x)
        ssm_out, ssm_cache = self.ssm(x, cache=cache)
        x = residual + ssm_out

        # MoE with residual
        residual = x
        x = self.post_ssm_norm(x)
        x = residual + self.moe(x)
        return x, ssm_cache
```

왜 마지막 구간에 어텐션이 없는가? 자기 회귀 생성(autoregressive generation)에서 중요한 것은 **마지막 토큰의 표현**이다. 이 시점에서 이미 Layer 9-16의 SWA가 추론을 완료했고, Layer 17-24는 이 추론 결과를 최종 토큰 분포로 변환하는 합성 단계다. 합성에는 어텐션의 전역 문맥이 필요 없다 — SSM의 선형 연산과 MoE의 전문가 지식으로 충분하다.

## 메모리 예산 상세 분석

MacBook Air M4 (16GB 통합 메모리)에서 모델을 구동하려면 메모리를 정밀하게 관리해야 한다. macOS가 시스템에 약 6-8GB를 할당하므로, 모델에 가용한 메모리는 약 8GB다.

### 가중치 메모리

| 구성 | 파라미터 수 | 메모리 (FP16) | 메모리 (4-bit) |
|------|-----------|--------------|---------------|
| 전체 모델 | 3.2B | ~6,400 MB | ~1,600 MB |
| SSM 레이어 (8개) | ~0.8B | ~1,600 MB | ~400 MB |
| SWA+MoE 레이어 (8개) | ~1.6B | ~3,200 MB | ~800 MB |
| SSM+MoE 레이어 (8개) | ~0.8B | ~1,600 MB | ~400 MB |

### 추론 메모리 (KV 캐시 + 활성화)

| 시퀀스 길이 | KV 캐시 (SWA 8레이어) | 활성화 메모리 | 총 추론 메모리 |
|-----------|---------------------|------------|------------|
| 4K | ~200 MB | ~400 MB | ~600 MB |
| 16K | ~200 MB | ~600 MB | ~800 MB |
| 64K | ~200 MB | ~1,200 MB | ~1,400 MB |

SWA의 KV 캐시가 시퀀스 길이에 따라 증가하지 않는 이유는 `window_size` 트리밍 때문이다. 윈도우 4096만큼만 KV 캐시를 유지하므로, 64K 시퀀스에서도 캐시 크기는 4K와 동일하다.

### 4-bit NF4 양자화

양자화는 모델 크기를 4배 줄이는 핵심 기술이다. NF4 (NormalFloat 4)는 정규 분포에 최적화된 4-bit 데이터 포맷으로, 일반적인 int4 양자화보다 정보 손실이 적다.

```python
class QuantizedSwitchLinear(nn.Module):
    def __init__(self, input_dims, output_dims, num_experts,
                 group_size=64, bits=4):
        # 그룹별 양자화: 64개 원소마다 스케일 팩터와 바이어스
        self.weight, self.scales, self.biases_quant = \
            mx.quantize(weight, group_size=group_size, bits=bits)

    def __call__(self, x: mx.array, indices: mx.array):
        # 양자화된 가중치 + gather를 결합한 단일 연산
        out = mx.gather_qmm(
            x_flat, self.weight, self.scales, self.biases_quant,
            rhs_indices=flat_idx, group_size=self.group_size, bits=self.bits
        )
```

`mx.gather_qmm`는 양자화 해제(dequantization)와 gather를 하나의 퓨전 연산으로 결합한다. 별도의 디코딩 단계 없이 양자화된 가중치를 직접 사용하므로 메모리 대역폭이 절약된다.

### 최종 메모리 구성

```
총 가용 메모리: ~8,000 MB
├─ 모델 가중치 (4-bit): ~1,600 MB
├─ KV 캐시 (고정): ~200 MB
├─ 활성화 (4K ctx): ~400 MB
├─ OS 예비: ~1,000 MB
└─ 남은 공간: ~4,800 MB (다른 작업 가능)
```

4-bit 양자화만으로 4K 컨텍스트에서 약 2.2GB, 64K 컨텍스트에서 약 3.2GB를 사용하여 16GB MacBook에서 여유롭게 구동된다.

## 서멀 인식 학습

Bit-Axon의 가장 실용적인 혁신은 **서멀 인식 학습 파이프라인**이다. 무팬 MacBook Air에서 지속적인 학습이 가능하도록 세 단계 서멀 정책을 적용한다.

### 서멀 정책 구현

```python
@dataclass
class ThermalPolicy:
    max_speed_temp: float = 75.0    # 이 온도 이하: 전속 학습
    pause_temp: float = 85.0        # 이 온도 이상: 학습 일시 정지
    stop_temp: float = 95.0         # 이 온도 이상: 학습 중단
    pause_duration: float = 0.5      # 냉각 대기 시간 (초)
```

```python
class CoolingScheduler:
    def __init__(self, monitor, policy: ThermalPolicy = None):
        self._monitor = monitor
        self._policy = policy or ThermalPolicy()
        self._total_pause_time: float = 0.0

    def check_before_step(self, step: int) -> None:
        temp = self._monitor.temperature
        if temp >= self._policy.stop_temp:  # 95°C 임계
            raise ThermalShutdownError(
                f"SoC temperature {temp:.1f}C exceeds stop threshold")
        while temp >= self._policy.pause_temp:  # 85°C 임계
            time.sleep(self._policy.pause_duration)  # 0.5초 대기
            self._total_pause_time += self._policy.pause_duration

    def should_reduce_batch(self) -> bool:
        temp = self._monitor.temperature
        return self._policy.max_speed_temp <= temp < self._policy.pause_temp
```

```
온도 < 75°C  → 정상: 전속 학습
온도 75-85°C → 경고: 배치 사이즈 자동 축소 (should_reduce_batch)
온도 85-95°C → 위험: 0.5초 단위 일시 정지 후 재개
온도 ≥ 95°C  → 임계: 학습 중단 (ThermalShutdownError)
```

### 온도 모니터링

macOS의 `powermetrics`를 통해 Apple Silicon SoC의 실시간 온도를 읽는다. 이 시스템 호출은 팬 속도, 전력 소비, 서멀 스로틀링 상태도 함께 제공한다. 무팬 모델에서는 서멀 스로틀링이 100°C 근처에서 시작되므로, 95°C에서 학습을 중단하면 스로틀링에 도달하기 전에 안전하게 대응할 수 있다.

### 배치 사이즈 동적 조절

`should_reduce_batch()`가 `True`를 반환하면 학습 루프는 배치 사이즈를 절반으로 줄인다. 배치 사이즈 감소는 GPU 연산량을 줄여 발열을 감소시킨다. 온도가 75°C 이하로 떨어지면 원래 배치 사이즈로 복원된다.

이 메커니즘은 학습 속도와 서멀 안전 사이의 자동 균형을 제공한다. 인간이 수동으로 배치 사이즈를 조절할 필요 없이, 시스템이 스스로 최적의 학습 속도를 유지한다.

## 시퀀스 패킹과 학습 효율

GPU 활용률을 극대화하기 위해 **시퀀스 패킹**을 사용한다:

```python
class SequencePacker:
    def __init__(self, max_seq_len: int = 2048, eos_token_id: int = 151645):
        self.max_seq_len = max_seq_len
        self.eos_token_id = eos_token_id

    def add_example(self, token_ids: list[int], loss_mask: list[int]):
        # 버퍼가 비어있지 않으면 EOS 구분자 삽입
        if self._buffer_ids:
            self._buffer_ids.append(self.eos_token_id)
            self._buffer_mask.append(0)  # 구분자에서는 손실 계산 안 함

        # 버퍼가 가득 차면 배치 반환
        while len(self._buffer_ids) >= self.max_seq_len:
            yield PackedBatch(
                token_ids=buffer[:self.max_seq_len],
                loss_mask=mask[:self.max_seq_len]
            )
```

시퀀스 패킹은 여러 학습 예제를 하나의 시퀀스로 결합하여 GPU 메모리를 최대한 활용한다. 예를 들어 512 토큰짜리 예제 4개를 패딩 없이 2048 토큰 시퀀스 하나로 묶을 수 있다. EOS 토큰이 예제 사이의 구분자 역할을 하며, `loss_mask=0`으로 설정하여 구분자에서는 손실을 계산하지 않는다.

## ORPO 학습: SFT와 선호도 정렬을 동시에

Bit-Axon은 **ORPO (Odds Ratio Preference Optimization)**를 지원한다. ORPO의 핵심 장점은 별도의 참조 모델이 필요 없다는 것이다 — SFT와 선호도 정렬을 단일 모델에서 동시에 수행한다.

```python
def orpo_loss(chosen_logps, rejected_logps, beta=0.1):
    # 오즈비(odds ratio) 계산
    log_odds = (chosen_logps - rejected_logps) - \
               (log1mexp(chosen_logps) - log1mexp(rejected_logps))
    # 시그모이드 페널티
    loss = -mx.mean(nn.log_sigmoid(beta * log_odds))
    return loss
```

ORPO의 총 손실은 두 가지로 구성된다:

1. **NLL 손실**: 선택된(chosen) 시퀀스에서의 교차 엔트로피 손실 (일반적인 SFT)
2. **오즈비 페널티**: 선택된 시퀀스와 거부된(rejected) 시퀀스의 로그 확률 차이에 페널티

```python
def compute_orpo_loss(model, chosen_ids, chosen_labels,
                      rejected_ids, rejected_labels, beta=0.1):
    # 순방향 패스 (2회 — 참조 모델 불필요)
    logits_chosen = model(chosen_ids)
    logits_rejected = model(rejected_ids)

    # 선택된 시퀀스에서 NLL 손실
    nll_loss = cross_entropy_loss(logits_chosen, chosen_labels)

    # 선호도 비교
    chosen_logps = get_logps(logits_chosen, chosen_labels)
    rejected_logps = get_logps(logits_rejected, rejected_labels)

    # 결합 목적 함수
    orpo_penalty = orpo_loss(chosen_logps, rejected_logps, beta)
    total_loss = nll_loss + orpo_penalty
```

### 수치적 안정성

`log1mexp` 함수는 `log(1 - exp(x))`의 수치적으로 안정적인 계산을 제공한다:

```python
def log1mexp(x: mx.array) -> mx.array:
    threshold = mx.array(-_LN2)  # -ln(2)
    use_branch1 = x < threshold
    x_branch1 = mx.where(use_branch1, x, mx.zeros_like(x))
    x_branch2 = mx.where(~use_branch1, x, mx.zeros_like(x))
    branch1 = mx.log(-mx.expm1(x_branch1))         # x < -ln(2)인 경우
    branch2 = mx.log1p(-mx.exp(x_branch2))          # x >= -ln(2)인 경우
    return mx.where(use_branch1, branch1, branch2)
```

x가 0에 가까워지면 `1 - exp(x)`가 소수점 아래로 수렴하여 부동소수점 정밀도가 손실된다. 두 가지 분기로 이 문제를 회피한다.

### QLoRA와 DoRA

학습은 **QLoRA** (Quantized Low-Rank Adaptation)로 수행한다: 4-bit로 양자화된 기본 가중치를 고정하고, 저랭크 어댑터만 학습한다.

```python
@dataclass
class TrainingConfig:
    quantize_bits: int = 4
    quantize_group_size: int = 64
    lora_rank: int = 8
    lora_dropout: float = 0.0
    lora_scale: float = 20.0
    use_dora: bool = True  # Weight-Decomposed LoRA
```

**DoRA (Weight-Decomposed Low-Rank Adaptation)**는 LoRA의 변형으로, 가중치를 크기(magnitude)와 방향(direction)으로 분해한다:

```python
def __call__(self, x):
    y = self.linear(x)
    z = (self.dropout(x) @ self.lora_a) @ self.lora_b
    out = y + (self.scale * z).astype(x.dtype)

    # 원래 크기 보존 (DoRA 핵심)
    denom = mx.sqrt(self._dora_w_sq_norm + cross + d_sq)
    out = (self.m / denom).astype(x.dtype) * out
```

DoRA가 일반 LoRA보다 나은 이유는 **학습 중 가중치의 크기 변동을 방지**하기 때문이다. 일반 LoRA는 어댑터가 가중치에 더해지면서 원래 가중치의 크기가 변할 수 있는데, DoRA는 명시적으로 크기를 정규화하여 학습 안정성을 높인다.

## 모델 구성 요약

| 파라미터 | 값 | 설명 |
|---------|---|------|
| 총 파라미터 | 3.2B | MoE 포함 전체 파라미터 |
| 활성화 파라미터 | ~1.4B | Top-2 라우팅 시 |
| vocab_size | 32,000 | BPE 어휘 크기 |
| hidden_dim | 2,560 | 모델 은닉 차원 |
| num_layers | 24 | 3 구간 × 8 레이어 |
| num_heads | 32 | 헤드 수 (head_dim=80) |
| ssm_d_state | 16 | SSM 상태 벡터 차원 |
| ssm_d_conv | 4 | SSM 1D 컨볼루션 커널 |
| ssm_scan_step | 64 | 병렬 스캔 청크 사이즈 |
| swa_window_size | 4,096 | 슬라이딩 윈도우 크기 |
| moe_num_experts | 8 | 전문가 수 |
| moe_top_k | 2 | 활성화 전문가 수 |
| moe_shared_expert | true | 공유 전문가 사용 |
| max_seq_len | 65,536 | 최대 시퀀스 길이 |
| 양자화 | 4-bit NF4 | 그룹 사이즈 64 |

## 핵심 인사이트

### 1. 아키텍처로 하드웨어 제약을 해결하라

무팬 노트북의 서멀 한계는 소프트웨어 튜닝으로 해결할 수 없다. SSM의 선형 복잡도가 연산량을 줄이고, MoE의 희소 활성화가 메모리 대역폭을 절약하며, 서멀 스케줄러가 학습 속도를 동적으로 조절한다. 이 세 가지가 결합되어야 무팬 MacBook에서 지속적인 학습이 가능하다.

### 2. 프레임워크 선택이 하드웨어와 맞아야 한다

MLX의 제로카피 통합 메모리는 16GB MacBook에서 모델 구동을 가능하게 하는 결정적 요인이다. PyTorch의 GPU-CPU 메모리 복사는 동일한 하드웨어에서 2배의 메모리를 요구한다. 하드웨어에 맞는 프레임워크를 선택하는 것이 최적화의 첫 번째 단계다.

### 3. 각 레이어 구간에 최소 복잡도를 할당하라

문맥 흡수엔 SSM (O(n)), 추론엔 SWA (O(n × w)), 출력엔 SSM+MoE (선형+희소). 어텐션은 16개 레이어 중 8개에만 존재한다. 각 구간에 필요한 최소한의 연산만 할당하여 전체 복잡도를 관리한다. 이것이 "모든 레이어에 어텐션을 넣는 것"보다 효율적인 이유다.

### 4. 참조 모델 없는 정렬이 엣지 디바이스의 필수다

ORPO는 참조 모델이 필요 없으므로, 16GB 메모리에서 선호도 정렬이 가능하다. PPO나 DPO는 참조 모델을 메모리에 올려야 하므로, MacBook에서는 메모리 부족으로 실행이 불가능하다. 엣지 디바이스의 제약은 알고리즘 선택에 직접적인 영향을 미친다.

## 마치며

Bit-Axon은 엣지 디바이스에서 LLM을 구동하기 위한 하나의 실험이다. 삼층 샌드위치 아키텍처가 하드웨어 제약에 맞는 연산을 할당하고, MLX가 통합 메모리를 최대한 활용하며, 서멀 인식 학습이 물리적 한계 내에서 지속 가능한 학습을 가능하게 한다.

이 세 가지가 결합하면 무팬 MacBook에서도 3.2B 모델을 실용적으로 구동할 수 있다. 16GB 통합 메모리, 4-bit 양자화, Apple Silicon의 효율적인 GPU — 이 하드웨어 조합이 소비자 기기에서 LLM을 구동하는 새로운 가능성을 열고 있다.

전체 소스 코드는 [github.com/skyoo2003/bit-axon](https://github.com/skyoo2003/bit-axon)에서, 모델은 [HuggingFace](https://huggingface.co/skyoo2003/bit-axon)에서 확인할 수 있다.
