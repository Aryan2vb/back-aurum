import { IsEnum, IsOptional, IsString, IsArray } from 'class-validator';

export enum SendChannel {
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
  BOTH = 'BOTH',
}

export class SendInvoiceDto {
  @IsEnum(SendChannel)
  channel: SendChannel;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  recipientEmails?: string[];
}
