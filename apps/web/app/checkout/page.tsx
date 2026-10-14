'use client';
import { RequireRole } from '../../components/RequireRole';
import { Checkout } from './Checkout';

/** Thanh toán (ui/checkout, ui/checkout-blocked, CHK-REQ-20261006-105050948 đến ...105052414): chỉ customer; staff và admin thấy màn không có quyền, guest chuyển tới đăng nhập. */
export default function Page() { return <RequireRole roles={['customer']}><Checkout /></RequireRole>; }
