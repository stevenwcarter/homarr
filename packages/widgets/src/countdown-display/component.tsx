"use client";

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/dseg7-classic/700.css";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { Alert, Badge, Group, Paper, Progress, ScrollArea, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconHourglassHigh } from "@tabler/icons-react";

import { useCurrentIntlLocale, useI18n } from "@homarr/translation/client";

import { useWidgetNow } from "../common/use-widget-now";
import { getCountdownEventState, getCountdownProgress, groupCountdownStates } from "../countdown/recurrence";
import type { CountdownEventState } from "../countdown/recurrence";
import type { WidgetComponentProps } from "../definition";
import styles from "./component.module.css";
import { getCountdownBreakdown, trimLeadingZeroParts } from "./duration";
import { getCountdownFont } from "./fonts";
import { CountdownInline, CountdownTiles } from "./tiles";
import type { CountdownNumeralStyle } from "./tiles";
import { normalizeCountdownUnits } from "./units";
import type { CountdownUnit } from "./units";

export default function CountdownDisplayWidget({
  displayMode,
  options,
  width,
}: WidgetComponentProps<"countdownDisplay">) {
  const units = useMemo(() => normalizeCountdownUnits(options.units), [options.units]);
  const now = useWidgetNow(units.includes("second") ? "second" : "minute");
  const locale = useCurrentIntlLocale();
  const t = useI18n("widget.countdownDisplay");
  const states = useMemo(() => {
    if (!now) return [];
    return options.events.map((event) => getCountdownEventState(event, now));
  }, [now, options.events]);
  const grouped = useMemo(() => groupCountdownStates(states), [states]);
  const font = getCountdownFont(options.font);
  const numeral: CountdownNumeralStyle = {
    fontFamily: font.family,
    sevenSegment: font.sevenSegment,
    glow: options.glow,
    scale: options.scale,
  };

  if (!now) {
    return (
      <Stack h="100%" align="center" justify="center">
        <Text c="dimmed">—</Text>
      </Stack>
    );
  }

  const hero = states[0];
  if (!hero) {
    return (
      <Stack h="100%" align="center" justify="center" gap="xs" p="md">
        <ThemeIcon variant="light" size="xl" radius="xl">
          <IconHourglassHigh />
        </ThemeIcon>
        <Text fw={600}>{t("empty.title")}</Text>
        <Text size="sm" c="dimmed" ta="center">
          {t("empty.description")}
        </Text>
      </Stack>
    );
  }

  if (displayMode !== "advanced") {
    return (
      <Stack className={styles.root} h="100%" justify="center" p="sm">
        <CountdownHero
          state={hero}
          now={now}
          units={units}
          numeral={numeral}
          locale={locale}
          showProgress={options.showProgress}
        />
      </Stack>
    );
  }

  const eventColumns = width >= 700 ? 2 : 1;
  return (
    <Stack className={styles.root} h="100%" gap="md" p="md">
      <Paper withBorder p="lg" radius="md" style={{ flex: "0 0 55%", minHeight: 0, overflow: "hidden" }}>
        <CountdownHero
          state={hero}
          now={now}
          units={units}
          numeral={numeral}
          locale={locale}
          showProgress={options.showProgress}
        />
      </Paper>
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap="md" pb="xs">
          <EventSection
            title={t("upcoming")}
            states={grouped.upcoming.filter((state) => state !== hero)}
            now={now}
            units={units}
            locale={locale}
            showProgress={options.showProgress}
            columns={eventColumns}
          />
          <EventSection
            title={t("completedEvents")}
            states={grouped.completed.filter((state) => state !== hero)}
            now={now}
            units={units}
            locale={locale}
            showProgress={options.showProgress}
            columns={eventColumns}
          />
          {grouped.invalid.length > 0 && (
            <Alert color="yellow" title={t("invalid.title")}>
              {t("invalid.description", { count: grouped.invalid.length })}
            </Alert>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

const useTrimmedParts = (state: CountdownEventState, now: Date, units: CountdownUnit[]) =>
  useMemo(() => {
    if (!state.nextOccurrence) return [];
    return trimLeadingZeroParts(getCountdownBreakdown(now, state.nextOccurrence, units, state.event.timeZone));
  }, [now, state.event.timeZone, state.nextOccurrence, units]);

const CountdownHero = ({
  state,
  now,
  units,
  numeral,
  locale,
  showProgress,
}: {
  state: CountdownEventState;
  now: Date;
  units: CountdownUnit[];
  numeral: CountdownNumeralStyle;
  locale: string;
  showProgress: boolean;
}) => {
  const t = useI18n("widget.countdownDisplay");
  const parts = useTrimmedParts(state, now, units);
  let status: string | null = null;
  if (state.invalid) status = t("invalid.value");
  else if (state.completed) status = t("completed");

  return (
    <Stack className={styles.hero} h="100%" gap={4} align="center" justify="center">
      <Text className={styles.title} fw={600} truncate>
        {state.event.label}
      </Text>
      {status ? (
        <Text className={styles.status} fw={700}>
          {status}
        </Text>
      ) : (
        <>
          <div className={styles.tilesHost}>
            <CountdownTiles parts={parts} numeral={numeral} />
          </div>
          <div className={styles.inlineHost}>
            <CountdownInline parts={parts} />
          </div>
        </>
      )}
      <Text className={styles.target} size="xs" c="dimmed" truncate>
        {formatOccurrence(state, locale)}
      </Text>
      {showProgress && <CountdownProgress state={state} now={now} label={t("progress")} />}
    </Stack>
  );
};

const CountdownProgress = ({ state, now, label }: { state: CountdownEventState; now: Date; label: string }) => {
  const progress = getCountdownProgress(state, now);
  if (progress === null) return null;
  return (
    <Progress
      className={styles.progress}
      w="100%"
      maw="20rem"
      mt="xs"
      value={progress}
      aria-label={`${label}: ${Math.round(progress)}%`}
      animated={false}
    />
  );
};

const EventCard = ({
  state,
  now,
  units,
  locale,
  showProgress,
  progressLabel,
}: {
  state: CountdownEventState;
  now: Date;
  units: CountdownUnit[];
  locale: string;
  showProgress: boolean;
  progressLabel: string;
}) => {
  const t = useI18n("widget.countdownDisplay");
  const parts = useTrimmedParts(state, now, units);
  let value: ReactNode = <CountdownInline parts={parts} />;
  if (state.invalid) value = <Text fw={700}>{t("invalid.value")}</Text>;
  else if (state.completed) value = <Text fw={700}>{t("completed")}</Text>;

  return (
    <Paper className={styles.eventCard} withBorder p="sm">
      <Stack gap={4} h="100%">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600} truncate>
            {state.event.label}
          </Text>
          {state.event.recurrence === "yearly" && <Badge variant="outline">{t("yearly")}</Badge>}
        </Group>
        {value}
        <Stack gap={4} mt="auto">
          {showProgress && <CountdownProgress state={state} now={now} label={progressLabel} />}
          <Text size="xs" c="dimmed">
            {formatOccurrence(state, locale)}
          </Text>
        </Stack>
      </Stack>
    </Paper>
  );
};

const EventSection = ({
  title,
  states,
  now,
  units,
  locale,
  showProgress,
  columns,
}: {
  title: string;
  states: CountdownEventState[];
  now: Date;
  units: CountdownUnit[];
  locale: string;
  showProgress: boolean;
  columns: number;
}) => {
  if (states.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text fw={700}>{title}</Text>
      <SimpleGrid cols={columns} spacing="xs">
        {states.map((state) => (
          <EventCard
            key={state.event.id}
            state={state}
            now={now}
            units={units}
            locale={locale}
            showProgress={showProgress}
            progressLabel={title}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
};

const formatOccurrence = (state: CountdownEventState, locale: string) => {
  const occurrence = state.nextOccurrence ?? state.previousOccurrence;
  if (!occurrence) return state.event.timeZone;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: state.event.timeZone,
  }).format(occurrence);
};
