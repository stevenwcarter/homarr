"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionIcon, Box, Center, Group, Image, ScrollArea, Stack, Text, UnstyledButton } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";

import { clientApi } from "@homarr/api/client";
import { useCurrentIntlLocale, useI18n } from "@homarr/translation/client";
import { iconSizes } from "@homarr/ui";

import { WidgetEmptyState } from "../../common/empty-state";
import { useLocalWidgetState } from "../../common/use-local-widget-state";
import type { WidgetComponentProps } from "../../definition";
import { useWidgetRuntimeActions } from "../../runtime-hooks";
import { getUsableWidgetQueryData } from "../../common/query-state";
import classes from "./component.module.css";
import { ALL_PHOTOS_ALBUM_ID } from "./constants";
import { CarouselNavigation } from "./navigation";
import { orderAssets, resolveCurrentIndex, stepAssetId } from "./order";
import type { PhotoBackdrop, PhotoFit } from "./photo-stage";
import { PhotoStage } from "./photo-stage";
import type { SlideshowState } from "./slideshow-state";
import {
  createSlideshowState,
  getSlideshowStateKey,
  isSlideshowState,
  SLIDESHOW_STATE_VERSION,
} from "./slideshow-state";

export default function ImmichAlbumCarouselWidget({
  integrationIds,
  options,
  displayMode = "compact",
  widgetRuntimeRef,
  boardId,
  itemId,
}: WidgetComponentProps<"immich-albumCarousel">) {
  const [slideshow, setSlideshow] = useLocalWidgetState<SlideshowState>({
    key: getSlideshowStateKey(boardId, itemId),
    storage: "session",
    version: SLIDESHOW_STATE_VERSION,
    defaultValue: createSlideshowState,
    validate: isSlideshowState,
  });
  const [firstPreviewPhoto, setFirstPreviewPhoto] = useState<{ albumId: string; assetId: string } | null>(null);
  let albumId: string | undefined;
  if (options.albumId && options.albumId !== ALL_PHOTOS_ALBUM_ID) albumId = options.albumId;
  const integrationId = integrationIds[0] ?? "";

  const albumQuery = clientApi.widget.immich.getAlbum.useQuery(
    { integrationId, albumId },
    { enabled: integrationIds.length > 0 },
  );
  const previewQuery = clientApi.widget.immich.getAlbumPreview.useQuery(
    { integrationId, albumId: albumId ?? "", randomizePhotos: options.randomizePhotos },
    { enabled: integrationIds.length > 0 && albumId !== undefined },
  );
  const fullAlbum = getUsableWidgetQueryData(albumQuery);
  const preview = previewQuery.data;
  const album = fullAlbum ?? preview;

  useEffect(() => {
    const asset = preview?.assets[0];
    if (!albumId || !asset || fullAlbum || firstPreviewPhoto?.albumId === albumId) return;
    setFirstPreviewPhoto({ albumId, assetId: asset.id });
  }, [albumId, firstPreviewPhoto?.albumId, fullAlbum, preview?.assets]);

  const photoAssets = useMemo(() => {
    const assets = album?.assets.filter((asset) => asset.type === "IMAGE") ?? [];
    const firstAssetId =
      options.randomizePhotos && fullAlbum && firstPreviewPhoto && firstPreviewPhoto.albumId === albumId
        ? firstPreviewPhoto.assetId
        : null;
    return orderAssets(assets, { randomize: options.randomizePhotos, seed: slideshow.seed, firstAssetId });
  }, [album?.assets, albumId, firstPreviewPhoto, fullAlbum, options.randomizePhotos, slideshow.seed]);

  const setCurrentAssetId = useCallback(
    (currentAssetId: string | null) => setSlideshow((current) => ({ ...current, currentAssetId })),
    [setSlideshow],
  );
  const moveBy = useCallback(
    (offset: number) =>
      setSlideshow((current) => ({
        ...current,
        currentAssetId: stepAssetId(photoAssets, current.currentAssetId, offset),
      })),
    [photoAssets, setSlideshow],
  );
  const previousPhoto = useCallback(() => moveBy(-1), [moveBy]);
  const nextPhoto = useCallback(() => moveBy(1), [moveBy]);
  const setPaused = useCallback(
    (paused: boolean) => setSlideshow((current) => (current.paused === paused ? current : { ...current, paused })),
    [setSlideshow],
  );
  const toggleSlideshow = useCallback(
    () => setSlideshow((current) => ({ ...current, paused: !current.paused })),
    [setSlideshow],
  );
  useWidgetRuntimeActions(
    widgetRuntimeRef,
    photoAssets.length > 1 ? { previousPhoto, nextPhoto, toggleSlideshow } : {},
  );

  if (!album || (!fullAlbum && album.assets.length === 0)) return <WidgetEmptyState />;

  return (
    <Box h="100%" pos="relative">
      {album.assets.length === 0 || photoAssets.length === 0 ? (
        <NoPhotosInAlbum />
      ) : (
        <Carousel
          assets={photoAssets}
          currentAssetId={slideshow.currentAssetId}
          setCurrentAssetId={setCurrentAssetId}
          moveBy={moveBy}
          rotationInterval={options.rotationIntervalSeconds}
          showPhotoInfo={options.showPhotoInfo}
          showNavigationArrows={options.showNavigationArrows}
          photoFit={options.photoFit}
          backdrop={options.backdrop}
          backdropColor={options.backdropColor}
          albumName={album.albumName}
          advanced={displayMode === "advanced"}
          paused={slideshow.paused}
          setPaused={setPaused}
          toggleSlideshow={toggleSlideshow}
        />
      )}
    </Box>
  );
}

interface CarouselProps {
  assets: {
    id: string;
    fileModifiedAt: string;
    publicLink: string;
  }[];
  currentAssetId: string | null;
  setCurrentAssetId: (assetId: string | null) => void;
  moveBy: (offset: number) => void;
  rotationInterval: number;
  showPhotoInfo: boolean;
  showNavigationArrows: boolean;
  photoFit: PhotoFit;
  backdrop: PhotoBackdrop;
  backdropColor: string;
  albumName: string;
  advanced: boolean;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  toggleSlideshow: () => void;
}

function Carousel({
  assets,
  currentAssetId,
  setCurrentAssetId,
  moveBy,
  rotationInterval,
  showPhotoInfo,
  showNavigationArrows,
  photoFit,
  backdrop,
  backdropColor,
  albumName,
  advanced,
  paused,
  toggleSlideshow,
}: CarouselProps) {
  const t = useI18n("widget.immich-albumCarousel");
  const locale = useCurrentIntlLocale();
  const reduceMotion = useReducedMotion();

  const safeCurrentIndex = resolveCurrentIndex(assets, currentAssetId);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const currentAsset = assets[safeCurrentIndex]!;

  // Restarts whenever the shown photo changes, so every photo gets the full interval.
  useEffect(() => {
    if (paused || reduceMotion || assets.length <= 1) return;
    const timeout = setTimeout(() => moveBy(1), rotationInterval * 1000);
    return () => clearTimeout(timeout);
  }, [assets.length, currentAsset.id, moveBy, paused, reduceMotion, rotationInterval]);

  const arrows = showNavigationArrows && assets.length > 1;

  return (
    <Stack w="100%" h="100%" gap={0}>
      <Box w="100%" style={{ flex: 1, minHeight: 0 }} className={classes.carouselContainer}>
        <PhotoStage
          src={currentAsset.publicLink}
          alt={t("albumPhoto")}
          fit={advanced ? "fit" : photoFit}
          backdrop={backdrop}
          backdropColor={backdropColor}
          assetId={currentAsset.id}
        />

        {arrows && <CarouselNavigation onPrevious={() => moveBy(-1)} onNext={() => moveBy(1)} />}

        {assets.length > 1 && (
          <Group
            className={classes.carouselControls}
            data-visible={advanced || paused || undefined}
            gap={4}
            wrap="nowrap"
          >
            {advanced && !arrows && (
              <ActionIcon
                aria-label={t("actions.previousPhoto")}
                variant="filled"
                color="dark"
                radius="xl"
                size={40}
                onClick={() => moveBy(-1)}
              >
                <IconChevronLeft size="var(--mantine-font-size-lg)" />
              </ActionIcon>
            )}
            <ActionIcon
              aria-label={paused ? t("actions.resumeSlideshow") : t("actions.pauseSlideshow")}
              aria-pressed={paused}
              variant="filled"
              color="dark"
              radius="xl"
              size={advanced ? 40 : 32}
              onClick={toggleSlideshow}
            >
              {paused ? (
                <IconPlayerPlay size="var(--mantine-font-size-lg)" />
              ) : (
                <IconPlayerPause size="var(--mantine-font-size-lg)" />
              )}
            </ActionIcon>
            {advanced && !arrows && (
              <ActionIcon
                aria-label={t("actions.nextPhoto")}
                variant="filled"
                color="dark"
                radius="xl"
                size={40}
                onClick={() => moveBy(1)}
              >
                <IconChevronRight size="var(--mantine-font-size-lg)" />
              </ActionIcon>
            )}
          </Group>
        )}

        {(showPhotoInfo || advanced) && (
          <Stack gap="xs" className={classes.photoInfo} p="md">
            {albumName && (
              <Text size="xs" fw={600}>
                {albumName}
              </Text>
            )}
            <Group gap="xs">
              <IconCalendar size="var(--mantine-font-size-md)" />
              <Text size="xs">{new Date(currentAsset.fileModifiedAt).toLocaleDateString(locale)}</Text>
            </Group>
            <Text size="xs" c="dimmed">
              {safeCurrentIndex + 1} / {assets.length}
            </Text>
          </Stack>
        )}
      </Box>
      {advanced && (
        <ScrollArea px="xs" py={6}>
          <Group gap={6} wrap="nowrap">
            {assets.map((asset, index) => (
              <UnstyledButton
                key={asset.id}
                onClick={() => setCurrentAssetId(asset.id)}
                aria-label={t("actions.photo", { number: index + 1 })}
                aria-pressed={index === safeCurrentIndex}
                aria-current={index === safeCurrentIndex ? "true" : undefined}
              >
                <Image
                  src={asset.publicLink}
                  alt=""
                  loading="lazy"
                  w={64}
                  h={44}
                  radius="sm"
                  fit="cover"
                  style={{ opacity: index === safeCurrentIndex ? 1 : 0.55 }}
                />
              </UnstyledButton>
            ))}
          </Group>
        </ScrollArea>
      )}
    </Stack>
  );
}

function NoPhotosInAlbum() {
  const t = useI18n("widget.immich-albumCarousel");
  return (
    <Center h="100%">
      <Stack align="center" gap="xs">
        <IconAlertCircle style={iconSizes.xl} />
        <Text size="sm" fw={500}>
          {t("noPhotos")}
        </Text>
      </Stack>
    </Center>
  );
}
