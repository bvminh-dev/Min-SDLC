import { ConfigError, type ConfigService } from '../config/config';
import './config';
import { S3Storage } from './s3';
import { UnconfiguredStorage, type ObjectStorage } from './storage';

/** Kho ảnh theo cấu hình: dev có thể để trống (tải ảnh trả 503); staging và prod bắt buộc đủ biến (ConfigVar.requiredOutsideDev kiểm lúc nạp cấu hình). */
export function createStorage(c: ConfigService): ObjectStorage {
  const endpoint = c.get<string>('STORAGE_ENDPOINT');
  if (!endpoint) return new UnconfiguredStorage();
  // SB-09: staging và prod chỉ https; client ký và dựng URL trên gốc (origin) nên endpoint có đường dẫn con sẽ ký sai (chữ ký tính trên đường dẫn khác URL thật): từ chối ngay lúc khởi động.
  let u: URL | null = null;
  try { u = new URL(endpoint); } catch { /* báo ở dưới */ }
  const why = !u ? 'phải là URL hợp lệ' : u.pathname !== '/' || u.search || u.hash ? 'phải là gốc (không có đường dẫn con, query)' : c.get('APP_ENV') !== 'dev' && u.protocol !== 'https:' ? 'phải là https ở staging và prod (SB-09)' : null;
  if (why) throw new ConfigError([{ name: 'STORAGE_ENDPOINT', reason: why }]);
  const accessKey = c.get<string>('STORAGE_ACCESS_KEY'), secretKey = c.get<string>('STORAGE_SECRET_KEY');
  if (!accessKey || !secretKey) throw new ConfigError([{ name: !accessKey ? 'STORAGE_ACCESS_KEY' : 'STORAGE_SECRET_KEY', reason: 'bắt buộc khi đặt STORAGE_ENDPOINT' }]);
  return new S3Storage({ endpoint, bucket: c.get('STORAGE_BUCKET'), region: c.get('STORAGE_REGION'), accessKey, secretKey, publicBase: c.get('STORAGE_PUBLIC_BASE_URL') });
}
