use slidesage_backend::cards::{
	convert::{self, Error},
	validation::json::{Text, Value},
};

fn convert(raw: &str) -> Result<Value, Error> {
	convert::convert(
		&Value::parse(serde_json::from_str(raw).unwrap())
			.record()
			.unwrap(),
	)
}

#[test]
fn deterministic_hash_consumes_utf16_and_wraps_like_javascript() {
	for (text, expected) in [
		("op-1:card:1", "2aj3l1c48zd"),
		("😀:card:1", "1tlzywe2t3n"),
		("op-1:1:1", "t35ew3ivo3"),
	] {
		assert_eq!(convert::hash(&Text::new(text)), expected);
	}
	assert_ne!(
		convert::hash(&Text(vec![0xd800])),
		convert::hash(&Text(vec![0xfffd]))
	);
}

#[test]
fn parses_emphasis_without_treating_literal_stars_as_formatting() {
	assert_eq!(
		convert::inline_markup(&Text::new("Storage cuts **peak** costs")).stringify(),
		r#"[{"text":"Storage cuts "},{"text":"peak","bold":true},{"text":" costs"}]"#
	);
	assert_eq!(
		convert::inline_markup(&Text::new("5 * 3 = 15")).stringify(),
		r#"[{"text":"5 * 3 = 15"}]"#
	);
	assert_eq!(
		convert::inline_markup(&Text::new("***bold***")).stringify(),
		r#"[{"text":"*"},{"text":"bold","bold":true},{"text":"*"}]"#
	);
	assert_eq!(
		convert::inline_markup(&Text::new("* spaced*")).stringify(),
		r#"[{"text":" spaced","italic":true}]"#
	);
	assert_eq!(
		convert::inline_markup(&Text::new("***")).stringify(),
		r#"[{"text":"*","italic":true}]"#
	);
	assert_eq!(
		convert::inline_markup(&Text::new("****")).stringify(),
		r#"[{"text":"**","italic":true}]"#
	);
}

#[test]
fn preserves_affix_spacing_only_on_the_number_side() {
	assert_eq!(
		convert::clean_affix(&Text::new(" <b>GW</b> "), true).display(),
		" GW"
	);
	assert_eq!(
		convert::clean_affix(&Text::new(" <b>USD</b> "), false).display(),
		"USD "
	);
	assert_eq!(
		convert::clean_affix(&Text::new("\u{85}GW"), true).display(),
		"GW"
	);
}

#[test]
fn checks_request_fields_before_independent_draft_issues() {
	for (raw, expected) in [
		("{}", "operationId must be a non-empty string"),
		(
			r#"{"operationId":"x","sourceIds":false}"#,
			"sourceIds must be an array",
		),
		(
			r#"{"operationId":"x","cards":[[]]}"#,
			"cards[0].position must be a positive integer",
		),
		(
			r#"{"operationId":"x","cards":[null]}"#,
			"cards[0] must be an object",
		),
		(
			r#"{"operationId":"x","cards":[{"position":1,"role":"opening","takeaway":"T","draft":null},{"position":0}]}"#,
			"cards[1].position must be a positive integer",
		),
	] {
		assert!(matches!(convert(raw), Err(Error::Request(message)) if message == expected));
	}
	let result = convert(r#"{"operationId":"x","cards":[{"position":1,"role":"opening","takeaway":"T","draft":null},{"position":2,"role":"opening","takeaway":"T","draft":{"layout":"title","nodes":[{"type":"heading","text":"Hello"}]}}]}"#).unwrap();
	let results = result.record().unwrap().get("results").array().unwrap();
	assert!(
		results[0]
			.record()
			.unwrap()
			.get("issue")
			.record()
			.unwrap()
			.get("path")
			.string()
			.unwrap()
			.is("card")
	);
	assert!(!results[1].record().unwrap().get("card").undefined());
}
