import { StockService } from './stock.service';

describe('StockService.normalizePurity', () => {
  const service = new StockService({} as any);

  it('maps karat decimals and labels to canonical keys', () => {
    expect(service.normalizePurity('22.00', 'GOLD')).toBe('22K');
    expect(service.normalizePurity('22K', 'GOLD')).toBe('22K');
    expect(service.normalizePurity('916', 'GOLD')).toBe('22K');
    expect(service.normalizePurity('999', 'SILVER')).toBe('F');
  });
});
