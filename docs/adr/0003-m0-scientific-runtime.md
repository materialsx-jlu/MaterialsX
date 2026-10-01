# ADR 0003：M0 科学环境与求解器

- 状态：暂定，等待 Windows CI 和外部求解器实测
- 日期：2026-09-30

## 决策

基础科学环境固定 Python 3.12，由 uv 锁定。PDF 文本抽取同时验证 pypdf 与 pdfplumber：前者用于轻量文本，后者在需要词级 bbox 时使用。扫描 PDF 的 OCR 在 M0 后续验证，当前不能标记为已支持。

ASE/EMT 用于证明结构—计算器—结果链路，不代替 DFT。Quantum ESPRESSO 和 LAMMPS 采用可选受审容器/计算包，或连接用户已有可执行程序。是否随桌面安装包分发，要在许可证、体积、Windows/macOS 支持和启动耗时实测后决定。

## 放行条件

- macOS arm64 与 Windows x64 均能建立 Python 环境并通过 PDF/ASE 测试。
- QE 完成一个微型 SCF 并解析“收敛/未收敛”；记录赝势来源与 hash。
- LAMMPS 完成一个微型 MD 并解析日志；记录力场来源、单位制和 hash。
- Docker/求解器不可用时报告 `blocked`，不将输入生成等同于实际计算。
