'use client';
import { useParams } from 'next/navigation';
import { RequireRole } from '../../../../../components/RequireRole';
import { ReviewForm } from '../../../../../components/ReviewForm';

/** Viết đánh giá (ui/review-form, chế độ viết): chỉ customer; guest về đăng nhập, staff và admin thấy màn không có quyền. */
export default function NewReviewPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireRole roles={['customer']}><ReviewForm key={id} mode="create" productId={id} /></RequireRole>;
}
