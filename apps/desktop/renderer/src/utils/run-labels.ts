const runStatuses: Record<string, string> = {
  created: '已创建', waiting: '等待计算', waiting_model: '等待模型',
  running: '运行中', completed: '已完成', completed_with_limitations: '待复核',
  failed: '失败', cancelled: '已停止', interrupted: '已中断', blocked: '等待条件',
};
const settlements: Record<string, string> = {
  reconciliation_pending: '保留预留，待核对', reserved: '预留中',
  settled: '已结算', released: '预留已释放', not_billed: '不收费',
};

export const runStatusLabel = (status: string) => runStatuses[status] ?? status;
export const settlementLabel = (status: string) => settlements[status] ?? status;
