'use client';
import { useParams } from 'next/navigation';
import { RequireRole } from '../../../../../components/RequireRole';
import { ReviewForm } from '../../../../../components/ReviewForm';

/** Sửa đánh giá (ui/review-form, chế độ sửa): chỉ customer, chỉ đánh giá của mình (server trả 404 chung cho của người khác). */
export default function EditReviewPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireRole roles={['customer']}><ReviewForm key={id} mode="edit" reviewId={id} /></RequireRole>;
}
