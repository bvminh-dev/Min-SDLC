import { OrderApi } from '../order';

export class UsesOrder {
  constructor(private readonly orders: OrderApi) {}
  ok() { return this.orders.findForPayment('x'); }
  bad() { return this.orders.createPending({}); }
}
