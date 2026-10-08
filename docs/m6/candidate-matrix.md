# M6.0 checkpoint 许可与硬件矩阵

核对日期：2026-10-01。所有记录为目录候选，没有已安装或已验证运行的权重。代码/权重/训练数据许可独立；unknown 不授予权利。ASL 保留上游原称，不能推断为 Apache。

| Checkpoint | 角色 | 代码许可 | 权重声明 | 再分发 | 权重身份 | macOS CPU / MPS | Windows CPU / CUDA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [MACE-MP-0b3 medium](https://github.com/ACEsuit/mace-foundations/blob/16a9f178706ce053f3ca8531efbab00a305d0854/README.md) | 核心候选 | MIT | MIT | permitted-with-notices | download-hashed | 未测试 / 未测试 | 未测试 / 未测试 |
| [MACE-MP-0b2 small](https://github.com/ACEsuit/mace-foundations/blob/16a9f178706ce053f3ca8531efbab00a305d0854/README.md) | 扩展 | MIT | MIT | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [MACE-MPA-0 medium](https://github.com/ACEsuit/mace-foundations/blob/16a9f178706ce053f3ca8531efbab00a305d0854/README.md) | 扩展 | MIT | MIT | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [MACE-OMAT-0 medium](https://github.com/ACEsuit/mace-foundations/blob/16a9f178706ce053f3ca8531efbab00a305d0854/README.md) | 扩展 | MIT | ASL | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [MACE-MATPES-PBE-0](https://github.com/ACEsuit/mace-foundations/blob/16a9f178706ce053f3ca8531efbab00a305d0854/README.md) | 扩展 | MIT | ASL | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [MACE-MATPES-r2SCAN-0](https://github.com/ACEsuit/mace-foundations/blob/16a9f178706ce053f3ca8531efbab00a305d0854/README.md) | 扩展 | MIT | ASL | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [MACE-OMOL-0 extra-large](https://github.com/ACEsuit/mace-foundations/blob/16a9f178706ce053f3ca8531efbab00a305d0854/README.md) | 扩展 | MIT | ASL | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [MACE-MH-1](https://github.com/ACEsuit/mace-foundations/blob/16a9f178706ce053f3ca8531efbab00a305d0854/README.md) | 扩展 | MIT | ASL | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [CHGNet 0.3.0](https://github.com/CederGroupHub/chgnet/blob/b9a6c15860237297a5a5169660e83b2e61a78e76/README.md) | 核心候选 | BSD-3-Clause-LBNL | BSD-3-Clause-LBNL | permitted-with-notices | download-hashed | 未测试 / 未测试 | 未测试 / 未测试 |
| [CHGNet r2scan](https://github.com/CederGroupHub/chgnet/blob/b9a6c15860237297a5a5169660e83b2e61a78e76/README.md) | 扩展 | BSD-3-Clause-LBNL | BSD-3-Clause-LBNL | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [MatterSim v1.0.0 1M](https://github.com/microsoft/mattersim/blob/aedf510ec536cf24163edad4570eaceafdb7cb2b/README.md) | 扩展 | MIT | unknown | review-required | unverified | 未测试 / 禁用 | 未测试 / 未测试 |
| [MatterSim v1.0.0 5M](https://github.com/microsoft/mattersim/blob/aedf510ec536cf24163edad4570eaceafdb7cb2b/README.md) | 扩展 | MIT | unknown | review-required | unverified | 未测试 / 禁用 | 未测试 / 未测试 |
| [ORB v3 conservative inf OMat](https://github.com/orbital-materials/orb-models/blob/1794f852543600d1611d2a3728a95142574f5dc2/README.md) | 扩展 | Apache-2.0 | Apache-2.0 | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [SevenNet-0 11July2024](https://github.com/MDIL-SNU/SevenNet/blob/8d9905cc4f4b7ca93be02b37a263785add53c759/sevenn/pretrained_potentials/SevenNet_0__11Jul2024/README.md) | 扩展 | MIT | unknown | review-required | unverified | 未测试 / 未测试 | 未测试 / 未测试 |
| [MatGL TensorNet PES MatPES PBE 2025.2](https://github.com/materialyzeai/matgl/blob/8def32f2d1c33fa6b7ec72655306ee4ea02a303b/README.md) | 扩展 | BSD-3-Clause | unknown | review-required | publisher-digest | 未测试 / 未测试 | 未测试 / 未测试 |
| [UMA s-1p2p1](https://github.com/facebookresearch/fairchem/blob/c22fb1bedb2b4ca453376749f42999be1589856d/README.md) | 扩展 | MIT | unknown | restricted | publisher-digest | 未测试 / 未测试 | 未测试 / 未测试 |

训练数据许可当前全部 unknown，不能因模型可获取就声明原数据可再分发。元素清单尚未逐权重核验，所有温压范围均未知，不将论文训练范围写成产品保证。核心实际来源和哈希、环境目标、单位及质量策略见 [交付说明](README.md)。

框架 NequIP/Allegro/DeePMD 未绑定具体公开权重，不在本次 16 项潜能权重注册表中。MACE-MDP 仅偶极/极化率，也未作为能量/力势纳入。
