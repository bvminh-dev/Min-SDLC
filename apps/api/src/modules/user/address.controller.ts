import { Controller, Delete, Get, HttpCode, Patch, Post, UseInterceptors } from '@nestjs/common';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, type SessionContext } from '../platform';
import { AddressService } from './address.service';
import { LIMITS, NoStoreInterceptor } from './http';
import { addressCreateBody, addressPatchBody, idParams, type AddressCreate, type AddressPatch } from './policy';

/** Sổ địa chỉ: chỉ customer (staff, admin nhận 403 theo ma trận). `user_id` luôn từ phiên (SB-05, SB-06). */
@Controller('me/addresses')
@UseInterceptors(NoStoreInterceptor)
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get() @Action('Xem danh sách địa chỉ giao hàng của mình') @Roles('customer') @RateLimit(LIMITS.read) @Validate({})
  async list(@CurrentSession() s: SessionContext) { return { items: await this.addresses.list(s.user_id) }; }

  @Post() @Action('Thêm địa chỉ giao hàng') @Roles('customer') @RateLimit(LIMITS.addressWrite) @Validate({ body: addressCreateBody })
  create(@CurrentSession() s: SessionContext, @ValidBody() b: AddressCreate) { return this.addresses.create(s.user_id, b); }

  @Patch(':id') @Action('Sửa địa chỉ và đặt địa chỉ mặc định') @Roles('customer') @RateLimit(LIMITS.addressWrite) @Validate({ params: idParams, body: addressPatchBody })
  update(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }, @ValidBody() b: AddressPatch) { return this.addresses.update(s.user_id, p.id, b); }

  @Delete(':id') @Action('Xóa địa chỉ giao hàng') @HttpCode(204) @Roles('customer') @RateLimit(LIMITS.addressWrite) @Validate({ params: idParams })
  async remove(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }) { await this.addresses.remove(s.user_id, p.id); }
}
