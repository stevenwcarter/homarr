"use client";

import { ColorInput } from "@mantine/core";

import type { CommonWidgetInputProps } from "./common";
import { useWidgetInputTranslation } from "./common";
import { useFormContext } from "./form";

const swatches = ["#000000", "#1a1b1e", "#2e2e2e", "#495057", "#868e96", "#dee2e6", "#f8f9fa", "#ffffff"];

export const WidgetColorInput = ({ property, kind, options }: CommonWidgetInputProps<"color">) => {
  const t = useWidgetInputTranslation(kind, property);
  const form = useFormContext();

  return (
    <ColorInput
      label={t("label")}
      description={options.withDescription ? t("description") : undefined}
      format="hex"
      swatches={swatches}
      swatchesPerRow={8}
      {...form.getInputProps(`options.${property}`)}
    />
  );
};
