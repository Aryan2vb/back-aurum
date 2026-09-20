import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateInvoiceDto } from '../dto/update-invoice.dto';
import { normalizeTemplateType } from './invoice-template';

describe('normalizeTemplateType', () => {
  it('keeps the two non-standard layouts as they are', () => {
    expect(normalizeTemplateType('jewellery')).toBe('jewellery');
    expect(normalizeTemplateType('modern')).toBe('modern');
  });

  it('folds the standard aliases ("classic" from the editor, "default" from settings) into standard', () => {
    expect(normalizeTemplateType('standard')).toBe('standard');
    expect(normalizeTemplateType('classic')).toBe('standard');
    expect(normalizeTemplateType('default')).toBe('standard');
  });

  it('returns undefined when no format was given, so callers can keep the stored one', () => {
    expect(normalizeTemplateType(undefined)).toBeUndefined();
    expect(normalizeTemplateType(null)).toBeUndefined();
    expect(normalizeTemplateType('')).toBeUndefined();
  });
});

describe('UpdateInvoiceDto.templateType', () => {
  const errorsFor = async (templateType: unknown) =>
    validate(plainToInstance(UpdateInvoiceDto, { templateType }));

  it.each(['standard', 'classic', 'default', 'modern', 'jewellery'])('accepts %s', async (t) => {
    expect(await errorsFor(t)).toHaveLength(0);
  });

  it('rejects an unknown format instead of storing it', async () => {
    const errors = await errorsFor('fancy');
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('templateType');
  });

  it('is optional', async () => {
    expect(await validate(plainToInstance(UpdateInvoiceDto, {}))).toHaveLength(0);
  });
});
