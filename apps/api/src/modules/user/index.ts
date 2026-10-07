// Điểm vào công khai DUY NHẤT của module user: module khác chỉ import từ đây (SB-35, check:boundaries).
// `AddressService` (listAddresses, getAddress) cho CHK; `UserApi.countCustomers` cho DSH (architecture.md, bảng Giao diện module).
export { UserModule } from './user.module';
export { AddressService, type AddressForCheckout } from './address.service';
export { UserApi } from './user.api';
