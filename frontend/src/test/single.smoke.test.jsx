import { expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { STANDARD_GOVERNMENT_WARNING } from "../components/fields";
import { SINGLE_VERIFY_RESPONSE, makeImageFile, stubFetch } from "./helpers";

const CUSTOM_WARNING = "GOVERNMENT WARNING: Custom warning text for this application.";

test("single submit posts all seven form fields plus the image", async () => {
    const fetchMock = stubFetch(SINGLE_VERIFY_RESPONSE);
    const user = userEvent.setup();
    const imageFile = makeImageFile("front-label.png");
    const { container } = render(<App />);

    await user.type(screen.getByLabelText("Brand Name"), "Old Tom Distillery");
    await user.type(screen.getByLabelText("Class / Type"), "Straight Bourbon Whiskey");
    await user.type(screen.getByLabelText(/alcohol content/i), "45");
    await user.type(screen.getByLabelText("Bottle Size"), "750");
    await user.selectOptions(screen.getByLabelText("Bottle Size unit"), "mL");
    await user.type(screen.getByLabelText("Producer"), "Old Tom Spirits Co.");
    await user.type(screen.getByLabelText("Country of Origin"), "United States");

    const warningField = screen.getByLabelText(/government warning/i);
    await user.clear(warningField);
    await user.type(warningField, CUSTOM_WARNING);

    await user.upload(container.querySelector('input[type="file"]'), imageFile);
    await user.click(screen.getByRole("button", { name: /verify label/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/verify$/);

    const formData = options.body;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("image")).toBe(imageFile);
    expect(JSON.parse(formData.get("application_data"))).toEqual({
        brand_name: "Old Tom Distillery",
        class_type: "Straight Bourbon Whiskey",
        abv: "45",
        net_contents: "750 mL",
        producer: "Old Tom Spirits Co.",
        country_of_origin: "United States",
        government_warning: CUSTOM_WARNING,
    });
});

test("government warning is prefilled with the standard text and posts by default", async () => {
    const fetchMock = stubFetch(SINGLE_VERIFY_RESPONSE);
    const user = userEvent.setup();
    const { container } = render(<App />);

    expect(screen.getByLabelText(/government warning/i)).toHaveValue(STANDARD_GOVERNMENT_WARNING);

    await user.type(screen.getByLabelText("Brand Name"), "Old Tom Distillery");
    await user.type(screen.getByLabelText("Class / Type"), "Gin");
    await user.type(screen.getByLabelText(/alcohol content/i), "40");
    await user.type(screen.getByLabelText("Bottle Size"), "750");
    await user.type(screen.getByLabelText("Producer"), "Old Tom Spirits Co.");
    await user.type(screen.getByLabelText("Country of Origin"), "United States");
    await user.upload(container.querySelector('input[type="file"]'), makeImageFile("gin.png"));
    await user.click(screen.getByRole("button", { name: /verify label/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body.get("application_data"));
    expect(payload.government_warning).toBe(STANDARD_GOVERNMENT_WARNING);
});
