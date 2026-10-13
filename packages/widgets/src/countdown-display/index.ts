import { IconHourglassHigh } from "@tabler/icons-react";
import { z } from "zod/v4";

import { getTimeZoneOptions } from "../clock/world-clock";
import { createWidgetDefinition } from "../definition";
import { optionsBuilder } from "../options";
import { countdownFontKeys, countdownFonts } from "./fonts";
import { countdownUnits, defaultCountdownUnits } from "./units";

const maximumCountdownEvents = 20;

export const { definition, componentLoader } = createWidgetDefinition("countdownDisplay", {
  icon: IconHourglassHigh,
  supportsAdvancedFocus: true,
  createOptions() {
    return optionsBuilder.from((factory) => ({
      events: factory.dateTimeEventList({
        defaultValue: [],
        maxValues: maximumCountdownEvents,
        timeZoneOptions: getTimeZoneOptions(),
        withDescription: true,
      }),
      units: factory.multiSelect({
        defaultValue: [...defaultCountdownUnits],
        options: countdownUnits.map((unit) => ({
          value: unit,
          label: (t) => t(`widget.countdownDisplay.unit.${unit}.label`),
        })),
        withDescription: true,
      }),
      font: factory.select({
        defaultValue: "default",
        options: countdownFontKeys.map((key) => ({
          value: key,
          label: countdownFonts[key].label ?? ((t) => t("widget.countdownDisplay.font.default")),
        })),
        withDescription: true,
      }),
      scale: factory.slider({
        defaultValue: 100,
        validate: z.number().min(50).max(200),
        step: 5,
        withDescription: true,
      }),
      glow: factory.switch({ defaultValue: false, withDescription: true }),
      showProgress: factory.switch({ defaultValue: true }),
    }));
  },
}).withDynamicImport(() => import("./component"));
