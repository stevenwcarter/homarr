"use client";

import { Stack, Text } from "@mantine/core";

import type { WidgetComponentProps } from "../definition";

export default function CountdownDisplayWidget({ options }: WidgetComponentProps<"countdownDisplay">) {
  return (
    <Stack h="100%" align="center" justify="center">
      <Text c="dimmed">{options.events.length}</Text>
    </Stack>
  );
}
