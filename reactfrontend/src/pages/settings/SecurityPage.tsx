import { Stack, Typography } from '@mui/material';

export function SecurityPage() {
  return (
    <Stack spacing={1}>
      <Typography variant="h6" component="h3">
        Security
      </Typography>
      <Typography color="text.secondary">
        Change password (POST /api/v1/auth/password) and sign out everywhere
        (POST /api/v1/auth/logout-all, which revokes every refresh-token family for the
        user). Built in Phase 12.
      </Typography>
    </Stack>
  );
}
