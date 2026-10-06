import { Injectable } from '@nestjs/common';

/** Đồng hồ có thể thay trong test (đồng hồ giả cho giới hạn tần suất, backoff, audit gộp, dọn dữ liệu). */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
