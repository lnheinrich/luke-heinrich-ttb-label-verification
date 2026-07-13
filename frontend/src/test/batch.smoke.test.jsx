import { expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { STANDARD_GOVERNMENT_WARNING } from "../components/fields";
import { BATCH_VERIFY_RESPONSE, makeImageFile, stubFetch } from "./helpers";

const ROWS = [
    {
        toggleName: /^label 1/i,
        image: makeImageFile("label-one.png"),
        brand_name: "Old Tom Distillery",
        class_type: "Straight Bourbon Whiskey",
        abv: "45",
        amount: "750",
        unit: "mL",
        net_contents: "750 mL",
        producer: "Old Tom Spirits Co.",
        country_of_origin: "United States",
    },
    {
        toggleName: /^label 2/i,
        image: makeImageFile("label-two.png"),
        brand_name: "Chateau Margaux",
        class_type: "Red Wine",
        abv: "13.5",
        amount: "1.75",
        unit: "L",
        net_contents: "1.75 L",
        producer: "Chateau Margaux Estate",
        country_of_origin: "France",
    },
];

test("batch submit preserves per-image application data", async () => {
    const fetchMock = stubFetch(BATCH_VERIFY_RESPONSE);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Batch" }));
    await user.click(screen.getByRole("button", { name: /add empty label/i }));

    for (const row of ROWS) {
        await user.click(screen.getByRole("button", { name: row.toggleName }));

        const card = screen
            .getByRole("button", { name: row.toggleName })
            .closest("article");
        await user.upload(card.querySelector('input[type="file"]'), row.image);
        await user.type(within(card).getByLabelText("Brand Name"), row.brand_name);
        await user.type(within(card).getByLabelText("Class / Type"), row.class_type);
        await user.type(within(card).getByLabelText(/alcohol content/i), row.abv);
        await user.type(within(card).getByLabelText("Bottle Size"), row.amount);
        await user.selectOptions(within(card).getByLabelText("Bottle Size unit"), row.unit);
        await user.type(within(card).getByLabelText("Producer"), row.producer);
        await user.type(within(card).getByLabelText("Country of Origin"), row.country_of_origin);
    }

    await user.click(screen.getByRole("button", { name: /verify batch/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/verify\/batch$/);

    const formData = options.body;
    const images = formData.getAll("images");
    expect(images).toEqual([ROWS[0].image, ROWS[1].image]);

    const payload = JSON.parse(formData.get("application_data"));
    expect(payload).toEqual(
        ROWS.map((row) => ({
            brand_name: row.brand_name,
            class_type: row.class_type,
            abv: row.abv,
            net_contents: row.net_contents,
            producer: row.producer,
            country_of_origin: row.country_of_origin,
            government_warning: STANDARD_GOVERNMENT_WARNING,
        })),
    );
});
