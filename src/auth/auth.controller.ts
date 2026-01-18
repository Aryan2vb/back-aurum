import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, CurrentUserData } from './current-user.decorator';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {
    this.logger.log('AuthController initialized');
  }

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  signupFounder(@Body() dto: SignupDto, @Req() req: Request) {
    return this.authService.signupFounder(dto, this.extractRequestMeta(req));
  }

  @Post('accept-invite')
  @HttpCode(HttpStatus.CREATED)
  acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() req: Request) {
    return this.authService.acceptInvitation(dto, this.extractRequestMeta(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, this.extractRequestMeta(req));
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: CurrentUserData, @Req() req: Request) {
    return this.authService.logout(user, this.extractRequestMeta(req));
  }

  @Get('whoami')
  @UseGuards(JwtAuthGuard)
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

