import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';
import { CurrentUser, CurrentUserData } from './current-user.decorator';

const AUTH_THROTTLE = { limit: 10, ttl: 60_000 };

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {
    this.logger.log('AuthController initialized');
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  signupFounder(@Body() dto: SignupDto, @Req() req: Request) {
    return this.authService.signupFounder(dto, this.extractRequestMeta(req));
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, this.extractRequestMeta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: CurrentUserData, @Req() req: Request) {
    return this.authService.logout(user, this.extractRequestMeta(req));
  }

  @Get('whoami')
  @HttpCode(HttpStatus.OK)
  whoami(@CurrentUser() user: CurrentUserData) {
    return this.authService.whoami(user);
  }

  private extractRequestMeta(req: Request) {
    return {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    };
  }
}
