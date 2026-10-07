import { Controller, Delete, Get, HttpCode, Patch, Put, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, allowMultipart, type SessionContext } from '../platform';
import { AvatarService } from './avatar.service';
import { ALL_ROLES, LIMITS, NoStoreInterceptor } from './http';
import { passwordBody, profilePatchBody, type ProfilePatch } from './policy';
import { UserService } from './user.service';

// Tải ảnh là multipart/form-data: ngoại lệ hẹp của quy tắc application/json, vẫn qua kiểm Origin (USR-API đầu tài liệu).
allowMultipart('PUT', '/api/v1/me/avatar');

@Controller('me')
@UseInterceptors(NoStoreInterceptor)
export class MeController {
  constructor(private readonly users: UserService, private readonly avatars: AvatarService) {}

  @Get() @Action('Xem hồ sơ cá nhân') @Roles(...ALL_ROLES) @RateLimit(LIMITS.read) @Validate({})
  get(@CurrentSession() s: SessionContext) { return this.users.getProfile(s); }

  @Patch() @Action('Sửa hồ sơ cá nhân (họ tên, điện thoại)') @Roles(...ALL_ROLES) @RateLimit(LIMITS.profileWrite) @Validate({ body: profilePatchBody })
  patch(@CurrentSession() s: SessionContext, @ValidBody() b: ProfilePatch) { return this.users.updateProfile(s, b); }

  // Giới hạn đổi mật khẩu (5 lần sai mỗi 15 phút, 10 lần gọi mỗi giờ, bậc A) do AuthApi.changePassword thi hành chính xác bằng bộ đếm theo kết quả.
  @Put('password') @Action('Đổi mật khẩu') @HttpCode(200) @Roles(...ALL_ROLES) @Validate({ body: passwordBody })
  password(@CurrentSession() s: SessionContext, @Req() req: Request, @Res({ passthrough: true }) res: Response, @ValidBody() b: { current_password: string; new_password: string }) {
    return this.users.changePassword(s, req, res, b);
  }

  @Put('avatar') @Action('Tải lên và xóa ảnh đại diện') @Roles(...ALL_ROLES) @RateLimit(LIMITS.avatarUpload) @Validate({})
  upload(@CurrentSession() s: SessionContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.avatars.upload(s.user_id, req, res); }

  @Delete('avatar') @Action('Tải lên và xóa ảnh đại diện') @HttpCode(204) @Roles(...ALL_ROLES) @RateLimit(LIMITS.avatarDelete) @Validate({})
  async removeAvatar(@CurrentSession() s: SessionContext) { await this.avatars.remove(s.user_id); }
}
