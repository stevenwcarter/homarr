// @vitest-environment jsdom

import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mantine/core", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Image: ({ src, alt, className, ...rest }: any) => <img src={src} alt={alt} className={className} {...rest} />,
}));

import { PhotoStage } from "./photo-stage";

const mounted: { unmount: () => void; host: HTMLElement }[] = [];

const render = (element: ReactElement) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push({ unmount: () => act(() => root.unmount()), host });
  return { container: host };
};

afterEach(() => {
  for (const { unmount, host } of mounted.splice(0)) {
    unmount();
    host.remove();
  }
});

const props = { src: "https://example.test/p.jpg", alt: "Album photo", assetId: "p1", backdropColor: "#336699" };

describe("PhotoStage", () => {
  it("renders cover without a backdrop layer", () => {
    const { container } = render(<PhotoStage {...props} fit="cover" backdrop="blur" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.assetId).toBe("p1");
    expect(root.dataset.fit).toBe("cover");
    expect(container.querySelector('[data-backdrop-layer="blur"]')).toBeNull();
    expect(root.style.backgroundColor).toBe("");
  });

  it("renders a blurred copy behind a fitted photo", () => {
    const { container } = render(<PhotoStage {...props} fit="fit" backdrop="blur" />);
    const layer = container.querySelector<HTMLImageElement>('[data-backdrop-layer="blur"]');
    expect(layer?.getAttribute("src")).toBe(props.src);
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("renders a solid colour behind a fitted photo", () => {
    const { container } = render(<PhotoStage {...props} fit="fit" backdrop="color" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.backdrop).toBe("color");
    expect(root.style.backgroundColor).toBe("rgb(51, 102, 153)");
    expect(container.querySelector('[data-backdrop-layer="blur"]')).toBeNull();
  });
});
