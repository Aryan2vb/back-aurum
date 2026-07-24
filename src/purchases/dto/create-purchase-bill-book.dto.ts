import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreatePurchaseBillBookDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  purchaseIds?: string[];

  @IsString()
  @IsOptional()
  search?: string;
}
