"use client";

import {
  createTheme,
  type ThemeOptions,
  ThemeProvider,
} from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import type { ReactNode } from "react";

// Material UI theme mapped to the Oern design tokens in DESIGN.md.
const lightPalette = {
  primary: {
    main: "#c2410c",
    light: "#fb923c",
    dark: "#9a3412",
    contrastText: "#ffffff",
  },
  secondary: { main: "#172b4d", contrastText: "#ffffff" },
  error: { main: "#dc2626", light: "#fee2e2", dark: "#b91c1c" },
  warning: { main: "#d97706", light: "#fef3c7", dark: "#92400e" },
  info: { main: "#2563eb", light: "#dbeafe", dark: "#1d4ed8" },
  success: { main: "#16a34a", light: "#dcfce7", dark: "#166534" },
  background: { default: "#f8fafc", paper: "#ffffff" },
  text: { primary: "#172b4d", secondary: "#475569" },
  divider: "#e2e8f0",
  grey: { 100: "#f1f5f9", 200: "#e2e8f0" },
};

const themeOptions: ThemeOptions = {
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: "inherit",
    button: { textTransform: "none", fontWeight: 650 },
  },
  components: {
    // Focus ripples start a pulsing ripple on whatever control receives focus
    // in code (sheet open/close, page transitions restoring focus), so a tap on
    // one control appears to ripple another. Touch ripples stay on the pressed
    // control; keyboard focus uses the outline below instead. The pulsate
    // override is the only way to cover components that hard-code
    // focusRipple: true (BottomNavigationAction does not accept
    // disableFocusRipple); normal touch ripples never use the pulsate class.
    MuiButtonBase: {
      defaultProps: { focusRipple: false },
      styleOverrides: {
        root: {
          "& .MuiTouchRipple-ripplePulsate": { display: "none" },
          "&.Mui-focusVisible": {
            outline: "3px solid #2563eb",
            outlineOffset: "2px",
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, disableFocusRipple: true },
      styleOverrides: { root: { minHeight: 48, borderRadius: 999 } },
    },
    // MUI's default tab transition animates padding-top along with color.
    // Padding is a layout property, so every tab tap reflows the whole bar,
    // and the label is always visible so the padding never actually changes.
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: ({ theme }) => ({
          transition: theme.transitions.create("color", {
            duration: theme.transitions.duration.shorter,
          }),
        }),
      },
    },
    MuiIconButton: {
      defaultProps: { disableFocusRipple: true },
      styleOverrides: { root: { minWidth: 48, minHeight: 48 } },
    },
    MuiToggleButton: {
      defaultProps: { disableFocusRipple: true },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: { "&.Mui-focusVisible": { backgroundColor: "transparent" } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 650,
          "&.MuiChip-clickable.Mui-focusVisible": {
            backgroundColor: "transparent",
          },
        },
      },
    },
    // Outlined inputs match the native field spec in src/app/form-fields.css.
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          minHeight: 52,
          borderRadius: 12,
          background: "var(--color-surface, #ffffff)",
          fontSize: 16,
          // DESIGN.md: fields carry a 3px Live Blue outline with a 2px offset on
          // keyboard focus, in addition to the 2px Live Blue border below.
          "&:has(input:focus-visible), &:has(textarea:focus-visible)": {
            outline: "3px solid var(--color-info, #2563eb)",
            outlineOffset: 2,
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "var(--color-info, #2563eb)",
            borderWidth: 2,
          },
          "&.Mui-error .MuiOutlinedInput-notchedOutline": {
            borderColor: "var(--color-error, #dc2626)",
            borderWidth: 2,
          },
        },
        // The field box is 52px tall, so the input itself must fill it or the
        // tappable area shrinks to the text line.
        input: {
          // DESIGN.md: placeholders use Control Slate at full opacity, and the
          // caret is Kiln Orange. MUI's default is the text color at 42%.
          caretColor: "var(--color-brand-orange-action, #c2410c)",
          "&::placeholder": {
            color: "var(--color-border-control, #64748b)",
            opacity: 1,
          },
          "&:not(textarea)": {
            boxSizing: "border-box",
            height: 52,
            paddingTop: 0,
            paddingBottom: 0,
          },
        },
        notchedOutline: { borderColor: "var(--color-border-control, #64748b)" },
      },
    },
  },
};

const appTheme = createTheme({ ...themeOptions, palette: lightPalette });

// The manager console is deliberately denser than the customer and rider
// flows. Keep that density in a nested theme instead of overriding individual
// MUI controls in every admin screen.
const managerTheme = createTheme({
  ...themeOptions,
  shape: { borderRadius: 8 },
  palette: {
    primary: {
      main: "#0972d3",
      dark: "#075fae",
      light: "#f1faff",
      contrastText: "#ffffff",
    },
    secondary: { main: "#232f3e", contrastText: "#ffffff" },
    error: { main: "#d91515", light: "#fff7f7", dark: "#b10f0f" },
    warning: { main: "#8d6605", light: "#fffce9", dark: "#6f5004" },
    info: { main: "#0972d3", light: "#f1faff", dark: "#075fae" },
    success: { main: "#037f0c", light: "#f2fcf3", dark: "#026709" },
    background: { default: "#f2f3f3", paper: "#ffffff" },
    text: { primary: "#0f141a", secondary: "#5f6b7a" },
    divider: "#d5dbdb",
    grey: { 100: "#fafafa", 200: "#f2f3f3" },
  },
  typography: {
    fontFamily: "inherit",
    fontSize: 14,
    h1: { fontSize: 24, lineHeight: 1.33, fontWeight: 700 },
    h2: { fontSize: 18, lineHeight: 1.4, fontWeight: 700 },
    h3: { fontSize: 15, lineHeight: 1.4, fontWeight: 650 },
    button: { textTransform: "none", fontSize: 14, fontWeight: 650 },
  },
  components: {
    ...themeOptions.components,
    MuiButtonBase: {
      defaultProps: { focusRipple: false },
      styleOverrides: {
        root: {
          "& .MuiTouchRipple-ripplePulsate": { display: "none" },
          "&.Mui-focusVisible": {
            outline: "2px solid #0972d3",
            outlineOffset: "2px",
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, disableFocusRipple: true },
      styleOverrides: {
        root: {
          minHeight: 40,
          borderRadius: 8,
          paddingInline: 16,
          boxShadow: "none",
        },
      },
    },
    MuiIconButton: {
      defaultProps: { disableFocusRipple: true, size: "small" },
      styleOverrides: {
        root: { minWidth: 32, minHeight: 32, borderRadius: 8 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          minHeight: 40,
          borderRadius: 8,
          background: "#ffffff",
          fontSize: 14,
          "&:has(input:focus-visible), &:has(textarea:focus-visible)": {
            outline: "2px solid #0972d3",
            outlineOffset: 2,
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "#0972d3",
            borderWidth: 1,
          },
          "&.Mui-error .MuiOutlinedInput-notchedOutline": {
            borderColor: "#d91515",
            borderWidth: 2,
          },
        },
        input: {
          boxSizing: "border-box",
          height: 40,
          padding: "0 12px",
          caretColor: "#ec7211",
          "&::placeholder": { color: "#5f6b7a", opacity: 1 },
        },
        notchedOutline: { borderColor: "#8d99a8" },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0, variant: "outlined" },
      styleOverrides: {
        root: { borderColor: "#d5dbdb", borderRadius: 8, boxShadow: "none" },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: "none" } },
    },
    MuiChip: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: { height: 28, borderRadius: 8, fontWeight: 650 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8, alignItems: "center" },
        message: { paddingBlock: 4 },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: true, enterDelay: 500 },
    },
  },
});

export function RiderThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={appTheme}>{children}</ThemeProvider>;
}

export function ManagerThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={managerTheme}>{children}</ThemeProvider>;
}

export function MuiProvider({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={appTheme}>{children}</ThemeProvider>
    </AppRouterCacheProvider>
  );
}
