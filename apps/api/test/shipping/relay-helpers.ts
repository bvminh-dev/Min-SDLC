// Gom import của relay outbox (platform) và hằng số lùi lại dùng chung cho test SHP.
export { EventsService, OutboxRelay } from '../../src/modules/platform';
export { backoffMs as backoffMsOf } from '../../src/modules/platform/events/outbox-relay'; // check-report:allow test chạy trên nền, kiểm hằng số ADR-011
