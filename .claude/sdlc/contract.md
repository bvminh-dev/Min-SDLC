# Hợp đồng đầu ra của kit

Phần này **không đổi** khi đổi framework. Các skill phía sau dựa vào đây, không dựa vào định dạng của framework.

| Phase | Ghi ra | ID |
|---|---|---|
| discover | `spec/roadmap.md` (bảng cột `STT, Mã, Epic, Mục con`; mã epic 2-4 chữ in hoa) | không |
| foundation | `spec/constitution.md`, `spec/domain/roles.md`, `spec/domain/entities.md`, `spec/domain/events.md`, `spec/architecture.md`, `spec/security-baseline.md` | không (mã P-n, ADR-nnn, SB-nn) |
| research | `spec/epics/<EPIC>/requirements/<ID>.md`, `spec/epics/<EPIC>/flows/<FLOW-ID>.md`, `spec/permissions-matrix.md`, `spec/epics/<EPIC>/questions.md` (khi không hỏi trực tiếp được) | REQ, FLOW |
| impact | `spec/changes/<ID>.md` | không |
| design | `spec/epics/<EPIC>/design/<ID>.md` (DB, API, SEC) | DB, API, SEC |
| ui-ux | `spec/epics/<EPIC>/ui/`, `spec/testids.md` | không |
| test-design | `spec/epics/<EPIC>/tests/<ID>.md` | TC, E2E |
| implement | code + `spec/epics/<EPIC>/report.md` | không |
| review | `spec/epics/<EPIC>/review.md` | không |
| retro | `spec/lessons/<ngày>-<epic>.md` (đề xuất rule, chờ duyệt) | không |

ID theo `.claude/skills/sdlc-research/references/id-convention.md`. Kiểm hình thức bằng `check-spec.mjs`.
