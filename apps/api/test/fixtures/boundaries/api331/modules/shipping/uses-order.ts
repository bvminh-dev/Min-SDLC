import { OrderApi } from '../order';

export class UsesOrder {
  constructor(private readonly orders: OrderApi) {}
  ok() { return this.orders.findForShipment('x'); }
  bad() { return this.orders.getSalesReport({}); }
}
