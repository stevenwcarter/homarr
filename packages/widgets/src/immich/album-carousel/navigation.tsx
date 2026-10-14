"use client";

import type { MouseEvent } from "react";
import { ActionIcon } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

import { useI18n } from "@homarr/translation/client";

import classes from "./component.module.css";

interface CarouselNavigationProps {
  onPrevious: () => void;
  onNext: () => void;
}

const handle = (action: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
  action();
};

export const CarouselNavigation = ({ onPrevious, onNext }: CarouselNavigationProps) => {
  const t = useI18n("widget.immich-albumCarousel");

  return (
    <>
      <ActionIcon
        aria-label={t("actions.previousPhoto")}
        variant="filled"
        color="dark"
        radius="xl"
        size={40}
        className={classes.navArrow}
        data-carousel-nav="previous"
        onClick={handle(onPrevious)}
      >
        <IconChevronLeft size="var(--mantine-font-size-lg)" />
      </ActionIcon>
      <ActionIcon
        aria-label={t("actions.nextPhoto")}
        variant="filled"
        color="dark"
        radius="xl"
        size={40}
        className={classes.navArrow}
        data-carousel-nav="next"
        onClick={handle(onNext)}
      >
        <IconChevronRight size="var(--mantine-font-size-lg)" />
      </ActionIcon>
    </>
  );
};
