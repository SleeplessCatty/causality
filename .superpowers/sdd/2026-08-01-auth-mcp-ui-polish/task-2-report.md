# Task 2 Report: Shared Brand Icon and Favicon

## Delivered

- Added `AppBrandMark` as the shared Causality mark for the login page and application sidebar.
- Consolidated the deep-green, rounded-square, serif `C` styling into `.app-brand-mark`, so both surfaces use the same visual treatment.
- Added `/favicon.svg` with the same shape and referenced it from the web app's `index.html`.

## TDD Evidence

- Added assertions in `LoginPage.test.tsx` and `AppSidebar.test.tsx` for `data-brand-mark="causality"`.
- Confirmed RED: both assertions failed because the shared mark was absent.
- Confirmed GREEN: both focused test files pass after extracting the component.

## Verification

- `pnpm --filter @causality/web exec vitest run src/features/auth/LoginPage.test.tsx src/app/AppSidebar.test.tsx`
- `pnpm --filter @causality/web typecheck`
- `pnpm exec eslint apps/web/src/shared/brand/AppBrandMark.tsx apps/web/src/app/AppSidebar.tsx apps/web/src/features/auth/LoginPage.tsx apps/web/src/app/AppSidebar.test.tsx apps/web/src/features/auth/LoginPage.test.tsx`
- `pnpm exec prettier --check ...` (including `favicon.svg` with the HTML parser)
