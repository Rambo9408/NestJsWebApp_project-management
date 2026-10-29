import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  useGetNotificationsQuery,
  useGetUnreadCountQuery,
  useMarkAllReadMutation,
  useMarkReadMutation,
} from './notificationsApiSlice';
import { useNotificationStream } from './useNotificationStream';
import { useDisclosure } from '@/hooks/useDisclosure';

/**
 * =============================================================================
 * NotificationBell - the visible half of the SSE work
 * =============================================================================
 * MOUNTED ONCE, in RootLayout. That matters more than it looks: the SSE hook
 * lives here, so mounting this component twice would open two streams and burn
 * two of the browser's six connections per origin.
 *
 * "This component owns the connection" is a real constraint, and the way to
 * enforce it is to mount it in the layout rather than a page.
 * =============================================================================
 */
export function NotificationBell() {
  const { connected } = useNotificationStream();

  const { data: countData } = useGetUnreadCountQuery();
  const unread = countData?.unread ?? 0;

  /**
   * `useDisclosure` from Phase 3 - built long before there was a modal to use
   * it on. Note it is doing exactly the job it was designed for, and the
   * `anchorEl` below is the part it deliberately does NOT own: a menu needs an
   * element to anchor to, which is MUI-specific and not a disclosure concern.
   *
   * Resisting the urge to widen `useDisclosure` to hold an anchor is what keeps
   * it usable for drawers and dialogs too.
   */
  const menu = useDisclosure();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  /**
   * `skip` UNTIL THE MENU IS OPEN.
   *
   * The list is only ever seen inside the dropdown, so fetching it on every
   * page load is a request for data nobody looks at. The badge count comes from
   * the much cheaper `unread-count` endpoint.
   *
   * This is one of RTK Query's most useful options and one of the least used -
   * "fetch when needed" is otherwise an effect and a flag.
   */
  const { data, isLoading } = useGetNotificationsQuery({ limit: 20 }, { skip: !menu.isOpen });

  const [markRead] = useMarkReadMutation();
  const [markAllRead, { isLoading: isMarkingAll }] = useMarkAllReadMutation();

  return (
    <>
      {/*
        THE LIVE INDICATOR. A stream that has silently died is worse than no
        stream: the user believes they are up to date and they are not.

        The tooltip explains the dot - a coloured dot with no accessible name is
        decoration, and `title` on the IconButton gives it a name for everyone.
      */}
      <Tooltip title={connected ? 'Live updates connected' : 'Reconnecting...'}>
        <IconButton
          color="inherit"
          onClick={(event) => {
            setAnchorEl(event.currentTarget);
            menu.open();
          }}
          /*
            The accessible name INCLUDES THE COUNT. A screen-reader user
            otherwise hears "Notifications, button" and has no idea there are
            three waiting - the badge is purely visual.
          */
          aria-label={
            unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'
          }
          aria-haspopup="menu"
          aria-expanded={menu.isOpen}
        >
          <Badge
            badgeContent={unread}
            color="error"
            // 99+ rather than a four-digit badge that breaks the layout.
            max={99}
            variant={unread > 0 ? 'standard' : 'dot'}
            invisible={unread === 0 && connected}
            // Grey dot when disconnected and nothing unread - a quiet signal
            // that the stream is down without shouting about it.
            sx={{ '& .MuiBadge-dot': { bgcolor: connected ? 'success.main' : 'grey.500' } }}
          >
            <Typography aria-hidden>&#9679;</Typography>
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={menu.isOpen}
        onClose={menu.close}
        slotProps={{ paper: { sx: { width: 360, maxHeight: 480 } } }}
      >
        <Stack direction="row" spacing={1} sx={{ px: 2, py: 1, alignItems: 'center' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            Notifications
          </Typography>
          {unread > 0 && (
            <Button
              size="small"
              disabled={isMarkingAll}
              onClick={() => {
                void markAllRead();
              }}
            >
              Mark all read
            </Button>
          )}
        </Stack>

        <Divider />

        {isLoading && (
          <Typography sx={{ p: 2 }} color="text.secondary">
            Loading...
          </Typography>
        )}

        {data && data.items.length === 0 && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">You are all caught up.</Typography>
          </Box>
        )}

        {data && data.items.length > 0 && (
          <List dense sx={{ py: 0 }}>
            {data.items.map((notification) => (
              <ListItemButton
                // The server id, never the index - this list has items inserted
                // at the FRONT by the SSE stream, which is precisely the case
                // Phase 4 showed corrupting state with index keys.
                key={notification.id}
                onClick={() => {
                  if (notification.readAt === null) void markRead(notification.id);
                }}
                sx={{
                  // Unread gets weight and a tint. Colour alone would fail
                  // WCAG 1.4.1, so the bold text carries it too.
                  bgcolor: notification.readAt === null ? 'action.hover' : undefined,
                  alignItems: 'flex-start',
                }}
              >
                <ListItemText
                  primary={notification.title}
                  secondary={
                    <>
                      {notification.body}
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ display: 'block', mt: 0.5 }}
                        color="text.disabled"
                      >
                        {new Date(notification.createdAt).toLocaleString()}
                      </Typography>
                    </>
                  }
                  slotProps={{
                    primary: {
                      sx: { fontWeight: notification.readAt === null ? 600 : 400 },
                    },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Menu>
    </>
  );
}
