use slidesage_cards::{
	assembly::{self, Error},
	validation::{
		self,
		json::{Text, Value},
	},
};

fn assemble(body: &str) -> Result<Value, Error> {
	let input = Value::parse(serde_json::from_str(body).unwrap())
		.record()
		.unwrap();
	assembly::assemble(&input)
}

#[test]
fn cleans_markup_controls_whitespace_and_unicode_without_losing_surrogates() {
	let input =
		Text::new("  <SPAN title='x>y'>Cafe\u{301}</SPAN>\u{85}\u{2069} a<b and c>d <custom>  ");
	assert_eq!(
		assembly::clean_text(&input).display(),
		"Café a<b and c>d <custom>"
	);
	let text = Text(vec![0xd800, b'e' as u16, 0x301, 0xdc00]);
	assert_eq!(assembly::clean_text(&text).0, [0xd800, 0xe9, 0xdc00]);
	assert_eq!(
		assembly::clean_text(&Text::new("<b disabled>x</b> <b data-x = v>x</b>")).display(),
		"<b disabled>x x"
	);
}

#[test]
fn enforces_request_field_evaluation_order() {
	for (input, expected) in [
		(r#"{}"#, "theme is not known"),
		(r#"{"theme":"paper"}"#, "title must be a non-empty string"),
		(r#"{"theme":"paper","title":"T"}"#, "cards must be an array"),
		(
			r#"{"theme":"paper","title":"T","cards":[null],"assetIds":[null]}"#,
			"assetIds[0] must be a non-empty string",
		),
	] {
		assert!(matches!(assemble(input), Err(Error::Request(message)) if message == expected));
	}
	assert!(matches!(
		assemble(r#"{"theme":"paper","title":"T","cards":[null]}"#),
		Err(Error::Validation(validation::Error::Conversion))
	));
}

#[test]
fn duplicate_ids_take_last_card_before_document_validation() {
	let error = assemble(
		r#"{"theme":"paper","title":"T","cards":[{"id":"c_first001","bad":true},{"id":"c_first001"}]}"#,
	)
	.unwrap_err();
	let Error::Validation(validation::Error::Schema(issue)) = error else {
		panic!("expected schema issue")
	};
	assert!(issue.path.is("document.cards.c_first001.takeaway"));
}

#[test]
fn normalizes_cards_and_cleans_only_document_title() {
	let document = assemble(r#"{"theme":"paper","title":" <b>Cafe\u0301</b>\u0000 title ","cards":[{"id":"c_first001","takeaway":" Original ","role":"opening","layout":"title","nodes":[{"id":"n_heading1","type":"heading","text":[{"text":" Original "}]}],"sourceIds":["s1","s1"]}]}"#).unwrap();
	let raw = document.record().unwrap();
	assert_eq!(raw.get("title").string().unwrap().display(), "Café title");
	let card = raw
		.get("cards")
		.record()
		.unwrap()
		.get("c_first001")
		.record()
		.unwrap();
	assert_eq!(
		card.get("takeaway").string().unwrap().display(),
		" Original "
	);
	assert_eq!(card.get("sourceIds").array().unwrap().len(), 1);
}
