import { WidgetDefinition } from "@site/src/types";
import { IconPhoto } from "@tabler/icons-react";

export const immichAlbumCarouselWidget: WidgetDefinition = {
  icon: IconPhoto,
  name: "Immich Album",
  description: "Shows a slideshow of pictures from an Immich album or your full library",
  path: "../../widgets/immich-album-carousel",
  configuration: {
    items: [
      {
        name: "Album",
        description:
          "Select an Immich album or All photos. An empty selection also shows random photos from your full library.",
        values: { type: "string" },
        defaultValue: "All photos",
      },
      {
        name: "Interval in seconds",
        description: "Rotate between pictures in the album every X seconds. Must be at least 1. Must be below 3600",
        values: { type: "string" },
        defaultValue: "",
      },
      {
        name: "Show photo info",
        description: "Display date of the picture and the current index at the bottom of the slideshow",
        values: { type: "boolean" },
        defaultValue: "no",
      },
      {
        name: "Randomize photos",
        description: "Show photos in a random order instead of always starting with the same album order.",
        values: { type: "boolean" },
        defaultValue: "no",
      },
      {
        name: "Navigation arrows",
        description: "Show previous and next arrows on the sides of the photo while the pointer is over the widget.",
        values: { type: "boolean" },
        defaultValue: "no",
      },
      {
        name: "Photo fit",
        description: "Cover fills the tile and crops the photo. Fit shows the whole photo and fills the rest with the backdrop.",
        values: { type: "string" },
        defaultValue: "Cover",
      },
      {
        name: "Backdrop",
        description: "What fills the space around a fitted photo and behind the focus view: a blurred copy of the photo, or a solid colour.",
        values: { type: "string" },
        defaultValue: "Blurred photo",
      },
      {
        name: "Backdrop colour",
        description: "Solid colour shown around the photo when the backdrop is set to colour.",
        values: { type: "string" },
        defaultValue: "#000000",
      },
    ],
  },
};
