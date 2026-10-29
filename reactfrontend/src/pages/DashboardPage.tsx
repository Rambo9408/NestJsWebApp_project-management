import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { paths } from '@/routes/paths';

/**
 * The app's landing page once authenticated.
 *
 * Deliberately a shell: Phase 20 fills it with real widgets driven by
 * `GET /tasks/stats`, which the backend already exposes. Building the chrome
 * first means the data layer has somewhere to land, rather than being written
 * speculatively.
 */
export function DashboardPage() {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Dashboard
        </Typography>
        <Typography color="text.secondary">
          Real widgets arrive in Phase 20, backed by GET /api/v1/tasks/stats.
        </Typography>
      </Box>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
        {[
          { label: 'Tasks', to: paths.tasks, hint: 'Filters live in the URL' },
          { label: 'Settings', to: paths.settingsProfile, hint: 'Nested layout routes' },
          { label: 'Sign in', to: paths.login, hint: 'RHF + Zod against the real API' },
        ].map((card) => (
          <Card key={card.to} variant="outlined" sx={{ flex: 1, minWidth: 220 }}>
            <CardContent>
              <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
                <Typography variant="h6" component="h3">
                  {card.label}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {card.hint}
                </Typography>
                <Button component={Link} to={card.to} size="small">
                  Open
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
