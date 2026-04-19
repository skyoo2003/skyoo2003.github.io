---
title: "A Three-Layer Sandwich Architecture for Running a 3.2B LLM on M4 MacBook"
date: 2026-04-19T00:00:00+09:00
tags: [llm, mlx, apple-silicon, m4, bit-axon]
---

## Introduction

A MacBook Air M4 has 16GB of unified memory. Train a 3B model with PyTorch and the fan spins up within minutes; on the fanless model, thermal throttling kicks in. [Bit-Axon](https://github.com/skyoo2003/bit-axon) is a 3.2B parameter hybrid language model that solves this constraint at the architecture level.

The core idea is a **three-layer sandwich structure**: 24 layers divided into three segments, each using a different computation paradigm.

```
Layer  1-8:  ████████████████████ Pure Axon-SSM        → Context absorption (O(1) memory)
Layer  9-16: ███████████████████ SWA + MoE             → Deep reasoning (O(n) attention)
Layer 17-24: ██████████████████ SSM + MoE              → Output synthesis (linear + sparse)
```

This isn't just an intuitive division. Each segment addresses one of the three fundamental limitations of the Transformer architecture — **quadratic complexity, memory explosion, and compute density**. This post covers the mathematical foundations of each layer group, MLX framework optimizations, and thermal-aware training — the complete design for running an LLM on a MacBook.

## Why MLX Over PyTorch?

The reason for choosing MLX on Apple Silicon is straightforward — it's the only framework that **properly leverages unified memory**.

| Feature | PyTorch (MPS) | MLX |
|---------|--------------|-----|
| Memory transfer | GPU → CPU copy required | Unified memory zero-copy |
| Compilation | `torch.compile` (beta) | `@mx.compile` (stable) |
| Apple Silicon optimization | General-purpose backend | Native optimization |
| SwiftUI integration | Not possible | Native app support |

PyTorch's MPS backend supports the Apple Silicon GPU but still requires memory copies between CPU and GPU. On a MacBook Air with 16GB unified memory, this copy overhead is critical — every tensor transfer consumes memory bandwidth and increases inference latency.

MLX, on the other hand, is designed directly for Apple's unified memory architecture. Since the CPU and GPU share the same physical memory, no tensor movement is needed. The `@mx.compile` decorator compiles performance-critical kernels natively to the Apple Silicon GPU, delivering consistently faster performance than PyTorch's MPS backend.

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

This difference is dramatic with a 4-bit quantized 3.2B model. PyTorch must place model weights in CPU memory first, then copy to the GPU — effectively requiring double the memory at load time. MLX allocates once and is done.

## Three-Layer Architecture: Design Philosophy

To understand the sandwich architecture, we first need to understand **why this particular division**.

The Transformer's core problem is attention's O(n²) complexity. When sequence length grows from 4K to 64K, attention compute increases by 256x. State Space Models (SSMs) solve this with O(n) complexity but can't model the complex dependencies that attention handles.

Bit-Axon's approach is to **hierarchically combine the strengths of both paradigms**:

- **Context absorption (SSM)**: Linear complexity is essential when ingesting 64K tokens. Processing 64K tokens with attention is impossible in 16GB memory.
- **Deep reasoning (SWA + MoE)**: Semantic relationships, causal inference, and complex pattern matching require attention, but only over a local window — not the entire sequence.
- **Output synthesis (SSM + MoE)**: During final token generation, the reasoning is already complete and we're synthesizing representations. SSM's linear compute is sufficient. MoE selectively applies expert knowledge to boost quality.

This design follows a principle of **assigning minimum complexity to each layer group**. Attention only where it's needed; SSM everywhere else.

```python
@staticmethod
def _get_layer_type(layer_idx: int, total_layers: int) -> str:
    third = total_layers // 3  # 8 layers each
    if layer_idx < third:           # Layers 0-7: Pure SSM
        return "ssm"
    elif layer_idx < 2 * third:     # Layers 8-15: SWA + MoE
        return "swa_moe"
    else:                           # Layers 16-23: SSM + MoE
        return "ssm_moe"
```

## Layers 1-8: Pure Axon-SSM (Context Absorption)

The first 8 layers are pure Mamba-style **State Space Models (SSM)**. No attention means no KV cache, and memory per token is constant at O(1). This is why 64K context is possible.

### Mathematical Foundations of SSM

SSMs start from continuous-time state space models:

```
h'(t) = Ah(t) + Bx(t)    (state equation)
y(t)  = Ch(t) + Dx(t)     (output equation)
```

Where `x(t)` is the input, `h(t)` is the state vector, `y(t)` is the output, and `A/B/C/D` are learnable parameter matrices. Discretizing the continuous model:

```
h_t = Āh_{t-1} + B̄x_t
y_t = Ch_t + Dx_t
```

Discretization uses the **Zero-Order Hold (ZOH)** method, with `dt` (step size) as a learnable parameter. The fact that `dt` can take different values per token is Mamba's core innovation — the state update speed adjusts based on input.

### AxonSSM Implementation Details

```python
class AxonSSM(nn.Module):
    def __init__(self, config: BitAxonConfig):
        self.in_proj = nn.Linear(D, 2 * E, bias=False)          # Split input into x and z branches
        self.conv1d = nn.Conv1d(E, E, kernel_size=d_conv, groups=E)  # Depthwise causal convolution
        self.x_proj = nn.Linear(E, d_state * 2 + 1, bias=False)   # Project to B, C, dt params
        self.dt_proj = nn.Linear(1, E, bias=True)                # Per-channel step sizes
        self.out_proj = nn.Linear(E, D, bias=False)              # Output projection
        self.A_log = mx.log(mx.arange(1, d_state + 1))            # Diagonal SSM state matrix
        self.D = mx.ones((E,))                                    # Skip connection parameter
```

Key design decisions:

- **`A_log` initialization**: Initialized as `log(1), log(2), ..., log(d_state)` so that `A = -exp(A_log)` is a negative diagonal matrix. This guarantees the state decays exponentially over time, providing numerical stability.
- **Causal convolution (`conv1d`)**: A 1D convolution with kernel size 4 extracts local context first. This aligns with the intuition: "look at the pattern of the last 4 tokens first, then reflect that in the SSM state."
- **Gating**: The `z` branch controls information flow with SiLU activation. In the form `y = SiLU(z) * SSM(x)`, the SSM output is selectively weighted.

### Parallel Scan Algorithm

The sequential recurrence `h_t = Āh_{t-1} + B̄x_t` is O(n) but inherently sequential, seemingly impossible to parallelize. Mamba's core innovation is parallelizing this via **associative scan**.

Bit-Axon implements this in chunks:

```python
def _ssm_scan_parallel(self, x, dt, B_in, C_in):
    step = config.ssm_scan_step  # default 64
    for j in range(d_state):     # Each state dimension processed independently
        for i in range(0, L, step):
            S = min(step, L - i)
            dtA_chunk = dtA[:, i : i + S, :]
            dtx_chunk = dtx[:, i : i + S, :]
            B_chunk = B_in[:, i : i + S, j]
            C_chunk = C_in[:, i : i + S, j]
```

Chunk size 64 is optimized for Apple Silicon GPU's warp size and memory-compute balance. Too small and kernel launch overhead dominates; too large and memory usage increases.

### Segment Sum Optimization

The core operation of parallel scan — segment sum (`segsum`) — is compiled natively for MLX:

```python
def segsum(x: mx.array) -> mx.array:
    """Parallel segment sum for hardware-efficient computation"""
    seq_len = x.shape[-1]
    cs = mx.cumsum(x, axis=-1)
    diff = cs[..., :, None] - cs[..., None, :]
    mask = mx.tril(mx.ones((seq_len, seq_len), dtype=diff.dtype), -1)
    return diff * mask
```

This operation is compiled with `@mx.compile` and runs natively on the Apple Silicon GPU.

## Layers 9-16: SWA + MoE (Deep Reasoning)

The middle 8 layers combine **Sliding Window Attention (SWA)** with **Mixture of Experts (MoE)**. This segment handles the model's **reasoning capability**.

### Sliding Window Attention

Standard attention computes dot products for all token pairs, giving O(n²) complexity. SWA limits each token to attend to only the previous `window_size` tokens, reducing to O(n × window_size).

```python
def _make_sliding_window_mask(self, seq_len: int, kv_len: int, q_offset: int = 0):
    q_pos = mx.arange(q_offset, q_offset + seq_len)
    k_pos = mx.arange(kv_len)

    # Causal constraint: tokens can't see the future
    causal_mask = k_pos[None, :] <= (q_pos[:, None] + causal_offset)

    # Window constraint: limited attention range
    window_mask = (q_pos[:, None] + causal_offset) - k_pos[None, :] < self.window_size

    # Combined: -inf for positions outside causal+window
    mask = mx.where(causal_mask & window_mask, 0.0, -mx.inf)
```

The window size of 4096 is a deliberate choice. Most natural language dependencies resolve within 4K tokens — longer-range dependencies were already handled by the SSM layers (1-8). SWA thus performs **local refinement on top of the context that SSM has absorbed**.

### KV Cache Trimming

The core memory optimization of SWA is KV cache trimming:

```python
class KVCache:
    def __init__(self, window_size: int | None = None):
        self.window_size = window_size

    def update_and_fetch(self, xk: mx.array, xv: mx.array) -> tuple[mx.array, mx.array]:
        self.k = mx.concatenate([self.k, xk], axis=2)
        self.v = mx.concatenate([self.v, xv], axis=2)
        if self.window_size is not None:
            self.k = self.k[:, :, -self.window_size:]  # Trim to window
            self.v = self.v[:, :, -self.window_size:]
```

This is why memory only grows O(window_size) even when processing 64K sequences. KV cache entries outside the window are discarded — SWA doesn't reference them, so there's no information loss.

### MoE Implementation

MoE dynamically selects experts per token to sparsify computation:

```python
class SharedExpertMoE(nn.Module):
    def __call__(self, x: mx.array) -> mx.array:
        gates = self.gate(x)                      # (batch, seq_len, num_experts)
        gates = mx.softmax(gates, axis=-1)        # Softmax over experts

        # Top-k expert selection
        inds = mx.stop_gradient(mx.argpartition(-gates, kth=k-1, axis=-1)[..., :k])
        scores = mx.take_along_axis(gates, inds, axis=-1)

        # Expert processing
        y = self.switch_mlp(x, inds)
        y = (y * scores[..., None]).sum(axis=-2)  # Weighted combination
```

The **`gather_mm` optimization** is the core. Expert routing is mathematically "multiply input by the selected expert's weight matrix," but implementing this naively requires loading all expert weights into memory.

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

`mx.gather_mm` is a native MLX operation that **collects only the relevant rows from the weight matrix based on indices, then multiplies**. No need to iterate over all expert weights — only the rows belonging to each token's assigned expert are computed. Using sorted indices (`sorted_indices`) makes memory access patterns contiguous, maximizing cache efficiency.

A **Shared Expert** is an additional MLP applied to all tokens:

```python
# Shared expert gating
shared_out = self.shared_expert(x)
gate = sigmoid(shared_expert_gate(x))
output = gated_expert_output + gate * shared_out
```

The shared expert exists to guarantee **common knowledge that Top-2 routing might miss**. Things like "basic grammar of natural language" or "general world knowledge" should always be applied, not left to expert routing.

### Parameter Activation Efficiency

With Top-2 out of 8 experts, only 25% of MoE FFN parameters participate in computation per token. Including the shared expert, activated parameters per token are approximately 1.4B — just 44% of the total 3.2B.

## Layers 17-24: SSM + MoE (Output Synthesis)

The final 8 layers drop attention entirely, using only SSM + MoE. Linear recurrence combined with sparse experts enables **fast output generation**.

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

Why no attention in the final segment? In autoregressive generation, what matters most is the **representation of the last token**. At this point, the SWA layers (9-16) have already completed reasoning, and layers 17-24 are synthesizing the reasoning result into a final token distribution. Synthesis doesn't need attention's global context — SSM's linear compute and MoE's expert knowledge are sufficient.

## Detailed Memory Budget Analysis

Running a model on a MacBook Air M4 (16GB unified memory) requires precise memory management. macOS allocates about 6-8GB to the system, leaving roughly 8GB for the model.

### Weight Memory

| Configuration | Parameters | Memory (FP16) | Memory (4-bit) |
|---------------|-----------|--------------|---------------|
| Full model | 3.2B | ~6,400 MB | ~1,600 MB |
| SSM layers (8) | ~0.8B | ~1,600 MB | ~400 MB |
| SWA+MoE layers (8) | ~1.6B | ~3,200 MB | ~800 MB |
| SSM+MoE layers (8) | ~0.8B | ~1,600 MB | ~400 MB |

### Inference Memory (KV Cache + Activations)

| Sequence Length | KV Cache (SWA 8 layers) | Activation Memory | Total Inference Memory |
|----------------|------------------------|-------------------|----------------------|
| 4K | ~200 MB | ~400 MB | ~600 MB |
| 16K | ~200 MB | ~600 MB | ~800 MB |
| 64K | ~200 MB | ~1,200 MB | ~1,400 MB |

The KV cache doesn't grow with sequence length because of `window_size` trimming. Only 4096 entries of KV cache are maintained regardless of whether the sequence is 4K or 64K.

### 4-bit NF4 Quantization

Quantization is the core technique that reduces model size by 4x. NF4 (NormalFloat 4) is a 4-bit data format optimized for normal distributions, with less information loss than generic int4 quantization.

```python
class QuantizedSwitchLinear(nn.Module):
    def __init__(self, input_dims, output_dims, num_experts,
                 group_size=64, bits=4):
        # Per-group quantization: scale factor and bias per 64 elements
        self.weight, self.scales, self.biases_quant = \
            mx.quantize(weight, group_size=group_size, bits=bits)

    def __call__(self, x: mx.array, indices: mx.array):
        # Single fused operation: quantized weights + gather
        out = mx.gather_qmm(
            x_flat, self.weight, self.scales, self.biases_quant,
            rhs_indices=flat_idx, group_size=self.group_size, bits=self.bits
        )
```

`mx.gather_qmm` combines dequantization and gather into a single fused operation. Quantized weights are used directly without a separate decoding step, saving memory bandwidth.

### Final Memory Layout

```
Total available memory: ~8,000 MB
├─ Model weights (4-bit): ~1,600 MB
├─ KV cache (fixed): ~200 MB
├─ Activations (4K ctx): ~400 MB
├─ OS reserve: ~1,000 MB
└─ Remaining: ~4,800 MB (available for other work)
```

With 4-bit quantization alone, 4K context uses about 2.2GB and 64K context uses about 3.2GB — running comfortably on a 16GB MacBook.

## Thermal-Aware Training

Bit-Axon's most practical innovation is its **thermal-aware training pipeline**. A three-tier thermal policy enables sustained training on a fanless MacBook Air.

### Thermal Policy Implementation

```python
@dataclass
class ThermalPolicy:
    max_speed_temp: float = 75.0    # Below this: full-speed training
    pause_temp: float = 85.0        # Above this: pause training
    stop_temp: float = 95.0         # Above this: stop training
    pause_duration: float = 0.5      # Cool-down pause duration (seconds)
```

```python
class CoolingScheduler:
    def __init__(self, monitor, policy: ThermalPolicy = None):
        self._monitor = monitor
        self._policy = policy or ThermalPolicy()
        self._total_pause_time: float = 0.0

    def check_before_step(self, step: int) -> None:
        temp = self._monitor.temperature
        if temp >= self._policy.stop_temp:  # 95°C threshold
            raise ThermalShutdownError(
                f"SoC temperature {temp:.1f}C exceeds stop threshold")
        while temp >= self._policy.pause_temp:  # 85°C threshold
            time.sleep(self._policy.pause_duration)  # Wait 0.5s
            self._total_pause_time += self._policy.pause_duration

    def should_reduce_batch(self) -> bool:
        temp = self._monitor.temperature
        return self._policy.max_speed_temp <= temp < self._policy.pause_temp
```

```
Temp < 75°C  → Normal: Full-speed training
Temp 75-85°C → Warning: Auto batch size reduction (should_reduce_batch)
Temp 85-95°C → Danger: 0.5s pause intervals, resume when cool
Temp ≥ 95°C  → Critical: Training halted (ThermalShutdownError)
```

### Temperature Monitoring

Real-time temperature is read from Apple Silicon's SoC via macOS `powermetrics`. This system call also provides fan speed, power consumption, and thermal throttling status. On fanless models, thermal throttling kicks in around 100°C, so stopping training at 95°C allows safe response before throttling is reached.

### Dynamic Batch Size Adjustment

When `should_reduce_batch()` returns `True`, the training loop halves the batch size. Reduced batch size decreases GPU compute, which reduces heat generation. When temperature drops below 75°C, the original batch size is restored.

This mechanism provides automatic balance between training speed and thermal safety. No manual intervention needed — the system maintains optimal training speed on its own.

## Sequence Packing and Training Efficiency

**Sequence packing** maximizes GPU utilization:

```python
class SequencePacker:
    def __init__(self, max_seq_len: int = 2048, eos_token_id: int = 151645):
        self.max_seq_len = max_seq_len
        self.eos_token_id = eos_token_id

    def add_example(self, token_ids: list[int], loss_mask: list[int]):
        # Insert EOS separator if buffer is not empty
        if self._buffer_ids:
            self._buffer_ids.append(self.eos_token_id)
            self._buffer_mask.append(0)  # Don't compute loss on separators

        # Yield complete batches when buffer is full
        while len(self._buffer_ids) >= self.max_seq_len:
            yield PackedBatch(
                token_ids=buffer[:self.max_seq_len],
                loss_mask=mask[:self.max_seq_len]
            )
```

Sequence packing combines multiple training examples into a single sequence, maximizing GPU memory utilization. For example, four 512-token examples can be packed into one 2048-token sequence without padding. An EOS token serves as the separator between examples, with `loss_mask=0` ensuring no loss is computed on separator tokens.

## ORPO Training: SFT and Preference Alignment in One Pass

Bit-Axon supports **ORPO (Odds Ratio Preference Optimization)**. ORPO's key advantage is that no separate reference model is needed — supervised fine-tuning and preference alignment happen simultaneously in a single model.

```python
def orpo_loss(chosen_logps, rejected_logps, beta=0.1):
    # Odds ratio computation
    log_odds = (chosen_logps - rejected_logps) - \
               (log1mexp(chosen_logps) - log1mexp(rejected_logps))
    # Sigmoid penalty
    loss = -mx.mean(nn.log_sigmoid(beta * log_odds))
    return loss
```

ORPO's total loss consists of two components:

1. **NLL loss**: Cross-entropy loss on the chosen sequence (standard SFT)
2. **Odds ratio penalty**: Penalizes the difference in log probabilities between chosen and rejected sequences

```python
def compute_orpo_loss(model, chosen_ids, chosen_labels,
                      rejected_ids, rejected_labels, beta=0.1):
    # Forward passes (2x — no reference model needed)
    logits_chosen = model(chosen_ids)
    logits_rejected = model(rejected_ids)

    # NLL loss on chosen sequences
    nll_loss = cross_entropy_loss(logits_chosen, chosen_labels)

    # Preference comparison
    chosen_logps = get_logps(logits_chosen, chosen_labels)
    rejected_logps = get_logps(logits_rejected, rejected_labels)

    # Combined objective
    orpo_penalty = orpo_loss(chosen_logps, rejected_logps, beta)
    total_loss = nll_loss + orpo_penalty
```

### Numerical Stability

The `log1mexp` function provides numerically stable computation of `log(1 - exp(x))`:

```python
def log1mexp(x: mx.array) -> mx.array:
    threshold = mx.array(-_LN2)  # -ln(2)
    use_branch1 = x < threshold
    x_branch1 = mx.where(use_branch1, x, mx.zeros_like(x))
    x_branch2 = mx.where(~use_branch1, x, mx.zeros_like(x))
    branch1 = mx.log(-mx.expm1(x_branch1))         # For x < -ln(2)
    branch2 = mx.log1p(-mx.exp(x_branch2))          # For x >= -ln(2)
    return mx.where(use_branch1, branch1, branch2)
```

When x approaches 0, `1 - exp(x)` converges to subnormal floating-point numbers, losing precision. Two branches avoid this issue entirely.

### QLoRA and DoRA

Training uses **QLoRA** (Quantized Low-Rank Adaptation): 4-bit quantized base weights are frozen and only low-rank adapters are trained.

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

**DoRA (Weight-Decomposed Low-Rank Adaptation)** is a LoRA variant that decomposes weights into magnitude and direction:

```python
def __call__(self, x):
    y = self.linear(x)
    z = (self.dropout(x) @ self.lora_a) @ self.lora_b
    out = y + (self.scale * z).astype(x.dtype)

    # Preserve original magnitude (DoRA core)
    denom = mx.sqrt(self._dora_w_sq_norm + cross + d_sq)
    out = (self.m / denom).astype(x.dtype) * out
```

DoRA outperforms standard LoRA because it **prevents magnitude drift during training**. Standard LoRA adds adapters to weights, which can shift the original weight magnitude. DoRA explicitly normalizes magnitude, improving training stability.

## Model Configuration Summary

| Parameter | Value | Description |
|-----------|-------|-------------|
| Total parameters | 3.2B | Including MoE |
| Active parameters | ~1.4B | With Top-2 routing |
| vocab_size | 32,000 | BPE vocabulary size |
| hidden_dim | 2,560 | Model hidden dimension |
| num_layers | 24 | 3 segments × 8 layers |
| num_heads | 32 | Number of heads (head_dim=80) |
| ssm_d_state | 16 | SSM state vector dimension |
| ssm_d_conv | 4 | SSM 1D convolution kernel |
| ssm_scan_step | 64 | Parallel scan chunk size |
| swa_window_size | 4,096 | Sliding window size |
| moe_num_experts | 8 | Number of experts |
| moe_top_k | 2 | Active experts per token |
| moe_shared_expert | true | Shared expert enabled |
| max_seq_len | 65,536 | Maximum sequence length |
| Quantization | 4-bit NF4 | Group size 64 |

## Key Insights

### 1. Solve Hardware Constraints with Architecture

A fanless notebook's thermal limits can't be solved with software tuning alone. SSM's linear complexity reduces compute, MoE's sparse activation saves memory bandwidth, and the thermal scheduler dynamically adjusts training speed. All three are needed for sustained training on a fanless MacBook.

### 2. Match Your Framework to Your Hardware

MLX's zero-copy unified memory is the decisive factor that makes model inference possible on a 16GB MacBook. PyTorch's GPU-CPU memory copy demands double the memory on the same hardware. Choosing the framework that matches your hardware is the first step in optimization.

### 3. Assign Minimum Complexity to Each Layer Segment

Context absorption gets SSM (O(n)), reasoning gets SWA (O(n × w)), output gets SSM+MoE (linear + sparse). Attention exists in only 8 of 24 layers. Assigning only the minimum necessary computation to each segment manages total complexity more effectively than "putting attention in every layer."

### 4. Reference-Free Alignment is Essential for Edge Devices

ORPO requires no reference model, making preference alignment possible in 16GB memory. PPO or DPO require loading a reference model, making them impossible to run on a MacBook due to memory constraints. Edge device constraints directly influence algorithm selection.

## Conclusion

Bit-Axon is an experiment in running LLMs on edge devices. The three-layer sandwich architecture assigns computation suited to hardware constraints, MLX maximizes unified memory utilization, and thermal-aware training enables sustainable training within physical limits.

Combined, these make a 3.2B model practical on a fanless MacBook. 16GB unified memory, 4-bit quantization, Apple Silicon's efficient GPU — this hardware combination opens new possibilities for running LLMs on consumer devices.

Full source code at [github.com/skyoo2003/bit-axon](https://github.com/skyoo2003/bit-axon), model weights on [HuggingFace](https://huggingface.co/skyoo2003/bit-axon).
