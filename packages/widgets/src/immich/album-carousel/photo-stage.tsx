"use client";

import { Image } from "@mantine/core";

import classes from "./component.module.css";

export type PhotoFit = "cover" | "fit";
export type PhotoBackdrop = "blur" | "color";

interface PhotoStageProps {
  src: string;
  alt: string;
  fit: PhotoFit;
  backdrop: PhotoBackdrop;
  backdropColor: string;
  assetId: string;
}

export const PhotoStage = ({ src, alt, fit, backdrop, backdropColor, assetId }: PhotoStageProps) => {
  const fitted = fit === "fit";
  return (
    <div
      className={classes.stage}
      data-asset-id={assetId}
      data-fit={fit}
      data-backdrop={fitted ? backdrop : undefined}
      style={fitted && backdrop === "color" ? { backgroundColor: backdropColor } : undefined}
    >
      {fitted && backdrop === "blur" && (
        <img src={src} alt="" aria-hidden="true" className={classes.backdropBlur} data-backdrop-layer="blur" />
      )}
      <Image src={src} alt={alt} className={classes.carouselImage} data-fit={fitted ? "contain" : "cover"} />
    </div>
  );
};
