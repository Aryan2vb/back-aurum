import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RolesGuard } from './roles.guard';

const accessTokenTtlMinutes = Number(process.env.JWT_ACCESS_TTL_MINUTES ?? 180); // Default 3 hours (180 minutes)
const accessTokenTtlSeconds = accessTokenTtlMinutes * 60;

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      signOptions: { expiresIn: accessTokenTtlSeconds },
    }),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, AuthService, RolesGuard],
  exports: [JwtModule, PassportModule, AuthService, RolesGuard],
})
export class AuthModule {}
