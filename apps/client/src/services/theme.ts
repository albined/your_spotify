import { createTheme, useMediaQuery } from "@mui/material";
import { useMemo } from "react";
import { useSelector } from "react-redux";

import { selectDarkMode } from "./redux/modules/user/selector";
import { darkPalette, lightPalette } from "./themePalette";

export const useTheme = () => {
  const dark = useSelector(selectDarkMode);
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");

  const isDark = dark === "dark" || (dark === "follow" && prefersDarkMode);

  return useMemo(() => {
    const colors = isDark ? darkPalette : lightPalette;
    return createTheme({
      palette: {
        mode: isDark ? "dark" : "light",
        primary: {
          main: colors["accent-green"],
          contrastText: colors["text-inverse"],
        },
        secondary: { main: colors["accent-purple"] },
        background: {
          default: colors["surface-page"],
          paper: colors["surface-raised"],
        },
        text: {
          primary: colors["text-primary"],
          secondary: colors["text-secondary"],
          disabled: colors["text-tertiary"],
        },
        divider: colors["border-subtle"],
        error: { main: colors["color-error"] },
        warning: { main: colors["color-warning"] },
        info: { main: colors["accent-blue"] },
        success: { main: colors["accent-green"] },
        action: {
          active: colors["text-secondary"],
          hover: colors["surface-hover"],
          selected: colors["surface-selected"],
          focus: colors["surface-selected"],
        },
      },
      typography: {
        fontFamily: "var(--font)",
        button: { textTransform: "none", fontWeight: 600 },
      },
      components: {
        MuiTab: {
          defaultProps: {
            disableRipple: true,
            focusRipple: false,
            disableFocusRipple: true,
            disableTouchRipple: true,
          },
        },
        MuiTabs: {
          styleOverrides: {
            root: { backgroundColor: "var(--content-background)" },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: { backgroundImage: "none" },
            elevation1: { boxShadow: "none" },
          },
        },
        MuiButton: {
          defaultProps: { disableElevation: true },
          styleOverrides: { root: { borderRadius: 8 } },
        },
        MuiButtonBase: {
          styleOverrides: {
            root: {
              "&.Mui-focusVisible": {
                outline: `2px solid ${colors["focus-ring"]}`,
                outlineOffset: 3,
              },
            },
          },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: { borderRadius: 8 },
            notchedOutline: { borderColor: colors["border-control"] },
          },
        },
        MuiDialog: {
          styleOverrides: {
            paper: {
              boxShadow: colors["overlay-shadow"],
              "@media (max-width: 560px)": {
                margin: 12,
                maxWidth: "calc(100% - 24px)",
                "& .MuiDialogContent-root": { padding: 12 },
                "& .MuiDialogTitle-root": { padding: "16px 12px" },
              },
            },
          },
        },
        MuiPopover: {
          styleOverrides: { paper: { boxShadow: colors["overlay-shadow"] } },
        },
        MuiTooltip: {
          styleOverrides: {
            tooltip: {
              backgroundColor: colors["surface-raised"],
              color: colors["text-primary"],
              border: `1px solid ${colors["border-subtle"]}`,
              boxShadow: colors["overlay-shadow"],
              fontSize: 12,
            },
          },
        },
        MuiTableCell: {
          styleOverrides: {
            head: { color: colors["text-secondary"], fontWeight: 600 },
          },
        },
        MuiSkeleton: {
          styleOverrides: { rectangular: { borderRadius: "6px" } },
        },
      },
      shape: { borderRadius: 12 },
    });
  }, [isDark]);
};
