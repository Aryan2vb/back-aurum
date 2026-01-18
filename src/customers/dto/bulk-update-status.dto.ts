import { IsArray, IsString, IsEnum, ArrayMinSize } from 'class-validator';
import { CustomerStatus } from '@prisma/client';

export class BulkUpdateStatusDto {
    @IsArray()
    @IsString({ each: true })
    @ArrayMinSize(1)
    customerIds: string[];

    @IsEnum(CustomerStatus)
    status: CustomerStatus;
}
