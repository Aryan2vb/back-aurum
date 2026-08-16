import { IsBoolean, IsObject, IsOptional, IsString, Matches } from 'class-validator';

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class UpdateAccessPolicyDto {
  @IsOptional()
  @IsBoolean()
  accessWindowEnabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(HM, { message: 'accessWindowStart must be HH:mm' })
  accessWindowStart?: string;

  @IsOptional()
  @IsString()
  @Matches(HM, { message: 'accessWindowEnd must be HH:mm' })
  accessWindowEnd?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  /** module -> ["ADMIN","STAFF","VIEWER"] */
  @IsOptional()
  @IsObject()
  moduleAccess?: Record<string, string[]>;
}
