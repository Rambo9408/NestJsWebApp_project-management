import { Stack, Typography } from '@mui/material';

/**
 * A child of SettingsLayout, so it renders inside TWO outlets: AppLayout's and
 * SettingsLayout's. It contributes only its own content - the heading and tabs
 * belong to the layout above it.
 */
export function ProfilePage() {
  return (
    <Stack spacing={1}>
      <Typography variant="h6" component="h3">
        Profile
      </Typography>
      <Typography color="text.secondary">
        Name and email, backed by PATCH /api/v1/auth/me. Built in Phase 12 - the form
        pattern is already in place (RegisterForm), so this is mostly wiring.
      </Typography>
    </Stack>
  );
}
