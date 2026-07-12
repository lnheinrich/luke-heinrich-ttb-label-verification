export function scrollTileToViewportOffset(element, topOffset) {
    element.style.scrollMarginTop = `${topOffset}px`;
    element.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
}

export function scrollElementBottomToViewportBottom(element) {
    const targetTop = element.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
    window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
    });
}

export function scrollToPageBottomIfScrollable() {
    const maxScrollTop = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScrollTop <= 0) {
        return;
    }

    window.scrollTo({
        top: maxScrollTop,
        behavior: "smooth",
    });
}
