import { WidgetDefinition } from "@site/src/types";
import { IconHourglassHigh } from "@tabler/icons-react";

export const countdownDisplayWidget: WidgetDefinition = {
  icon: IconHourglassHigh,
  name: "Countdown display",
  description: "Large segmented countdown with selectable units and fonts.",
  path: "../../widgets/countdown-display",
  configuration: {
    items: [
      {
        name: "Events",
        description:
          "Add, edit, and order one-time, weekly, or yearly events with a date, time, and IANA timezone. The first event is shown large.",
        values: "Up to 20 events",
        defaultValue: "No events",
      },
      {
        name: "Units shown",
        description:
          'Which of decades, years, months, weeks, days, hours, minutes and seconds to display. Time from a hidden unit rolls into the next shown unit, so 45 days reads "1 month 15 days" when weeks are hidden.',
        values: {
          type: "select",
          options: ["Decades", "Years", "Months", "Weeks", "Days", "Hours", "Minutes", "Seconds"],
        },
        defaultValue: "Days, Hours, Minutes",
      },
      {
        name: "Numeral font",
        description:
          "Font for the numbers; labels keep the dashboard font. Fonts are bundled, nothing is fetched at runtime.",
        values: {
          type: "select",
          options: ["Dashboard font", "JetBrains Mono", "Space Grotesk", "Orbitron", "Bebas Neue", "7-segment (DSEG7)"],
        },
        defaultValue: "Dashboard font",
      },
      {
        name: "Size",
        description: "Percent multiplier on the auto-fitted numeral size.",
        values: "50 to 200",
        defaultValue: "100",
      },
      {
        name: "Glow",
        description: "Soft lighter glow behind the numbers.",
        values: { type: "boolean" },
        defaultValue: "no",
      },
      {
        name: "Show progress",
        description: "Show progress from an optional start date, or between recurring occurrences.",
        values: { type: "boolean" },
        defaultValue: "yes",
      },
    ],
  },
};
