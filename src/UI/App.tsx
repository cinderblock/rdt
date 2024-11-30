import * as React from 'react';
import { styled, createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import MuiDrawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import List from '@mui/material/List';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Badge from '@mui/material/Badge';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { Button, Chip, ListItem } from '@mui/material';
import { Unstable_Popup as BasePopup } from '@mui/base/Unstable_Popup';
import { LogData, useLogLabels, useLogs } from './log';

function Footer(props: any) {
  return (
    <Typography variant="body2" color="text.secondary" align="center" {...props}>
      Made with ❤️ by TWILL Technology
    </Typography>
  );
}

const drawerWidth: number = 240;

interface AppBarProps extends MuiAppBarProps {
  open?: boolean;
}

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: prop => prop !== 'open',
})<AppBarProps>(({ theme, open }) => ({
  zIndex: theme.zIndex.drawer + 1,
  transition: theme.transitions.create(['width', 'margin'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  ...(open && {
    marginLeft: drawerWidth,
    width: `calc(100% - ${drawerWidth}px)`,
    transition: theme.transitions.create(['width', 'margin'], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
  }),
}));

const Drawer = styled(MuiDrawer, { shouldForwardProp: prop => prop !== 'open' })(({ theme, open }) => ({
  '& .MuiDrawer-paper': {
    position: 'relative',
    whiteSpace: 'nowrap',
    width: drawerWidth,
    transition: theme.transitions.create('width', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    boxSizing: 'border-box',
    ...(!open && {
      overflowX: 'hidden',
      transition: theme.transitions.create('width', {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.leavingScreen,
      }),
      width: theme.spacing(7),
      [theme.breakpoints.up('sm')]: {
        width: theme.spacing(9),
      },
    }),
  },
}));

const mdTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

function LogLine({ time, level, label, message }: { time: number; level: string; label?: string; message: string }) {
  return (
    <Box>
      <Typography sx={{ fontFamily: 'Monospace' }} fontSize={9} color={level}>
        {message}
      </Typography>
    </Box>
  );
}

function useStaleTimeout(deps: any[], timeout = 10_000) {
  const [stale, setStale] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout>();
  React.useEffect(() => {
    setStale(false);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setStale(true), timeout);
  }, deps);

  return stale;
}

function LogView({ filter, height, label }: { filter?: (data: LogData) => boolean; height?: number; label: string }) {
  if (!filter)
    filter = React.useMemo(
      () =>
        ({ label: l }) =>
          l === label,
      [label],
    );

  const logLines = useLogs(filter);

  const scrollRef = React.useRef<HTMLElement>(null);

  const [autoScroll, setAutoScroll] = React.useState(true);

  // Whenever the list changes, scroll the last list item into view, if autoScroll is enabled
  React.useEffect(() => {
    if (!autoScroll) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [logLines, autoScroll]);

  // If the logs haven't been changed in a while, set a flag.
  const stale = useStaleTimeout([logLines], 10_000);

  return (
    <Paper
      sx={{
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        height,
        opacity: stale ? 0.5 : 1,
      }}
    >
      <Chip label={label} />

      <Box
        onClick={() => setAutoScroll(false)}
        ref={scrollRef}
        sx={{
          overflowY: 'scroll',
          scrollbarWidth: 'thin',
          scrollbarColor: '#888 transparent',
        }}
      >
        {logLines.map((line, index) => (
          <LogLine key={index} {...line} />
        ))}
      </Box>
      {autoScroll ? null : <Chip label={`Auto scroll`} onClick={() => setAutoScroll(true)} />}
    </Paper>
  );
}

function DashboardContent() {
  const [open, setOpen] = React.useState(true);
  const toggleDrawer = () => {
    setOpen(!open);
  };

  const labels = useLogLabels();

  const labelElements = {
    rdt: 'RDT',
    user: 'User',
    systemd: 'Systemd',
  };

  return (
    <ThemeProvider theme={mdTheme}>
      <Box sx={{ display: 'flex' }}>
        <CssBaseline />
        <AppBar position="absolute" open={open}>
          <Toolbar
            sx={{
              pr: '24px', // keep right padding when drawer closed
            }}
          >
            <IconButton
              edge="start"
              color="inherit"
              aria-label="open drawer"
              onClick={toggleDrawer}
              sx={{
                marginRight: '36px',
                ...(open && { display: 'none' }),
              }}
            >
              <MenuIcon />
            </IconButton>
            <Typography component="h1" variant="h6" color="inherit" noWrap sx={{ flexGrow: 1 }}>
              RDT Dashboard
            </Typography>

            <Button color="warning" variant="contained">
              Restart
            </Button>
            {/* <IconButton color="inherit">
              <Badge badgeContent={4} color="secondary">
                <NotificationsIcon />
              </Badge>
            </IconButton> */}
          </Toolbar>
        </AppBar>
        <Drawer variant="permanent" open={open}>
          <Toolbar
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              px: [1],
            }}
          >
            <IconButton onClick={toggleDrawer}>
              <ChevronLeftIcon />
            </IconButton>
          </Toolbar>
          <Divider />
          <List component="nav">
            <ListItem>Combined</ListItem>
            <Divider sx={{ my: 1 }} />
            <>
              {labels.map(label => (
                <ListItem key={label}>{labelElements[label as keyof typeof labelElements] ?? label}</ListItem>
              ))}
            </>
          </List>
        </Drawer>
        <Box
          component="main"
          sx={{
            backgroundColor: theme =>
              theme.palette.mode === 'light' ? theme.palette.grey[100] : theme.palette.grey[900],
            flexGrow: 1,
            height: '100vh',
            overflow: 'auto',
          }}
        >
          <Toolbar />
          <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6} lg={4}>
                <LogView height={240} label={'rdt'} />
              </Grid>
              <Grid item xs={12} md={6} lg={4}>
                <LogView height={240} label={'user'} />
              </Grid>
              <Grid item xs={12} lg={4}>
                <LogView height={240} label={'systemd'} />
              </Grid>
              {/* <Grid item xs={12}>
                <LogView height={240} label={'application'} />
              </Grid> */}
            </Grid>
            <Footer sx={{ pt: 4 }} />
          </Container>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default function Dashboard() {
  return <DashboardContent />;
}
