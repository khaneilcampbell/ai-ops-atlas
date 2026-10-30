#[cfg(test)]
mod tests {
    use glib::prelude::*;
    #[test]
    fn optimized_string_variant_iteration() {
        let values = ["alpha", "βeta", "", "omega"];
        let variant = values.to_variant();
        let strings = || variant.array_iter_str().expect("string array");
        assert_eq!(strings().collect::<Vec<_>>(), values);
        assert_eq!(
            strings().rev().collect::<Vec<_>>(),
            values.into_iter().rev().collect::<Vec<_>>()
        );
        assert_eq!(strings().nth(1), Some("βeta"));
        assert_eq!(strings().nth_back(1), Some(""));
        assert_eq!(strings().last(), Some("omega"));
        let mut mixed = strings();
        assert_eq!(mixed.next(), Some("alpha"));
        assert_eq!(mixed.next_back(), Some("omega"));
        assert_eq!(mixed.collect::<Vec<_>>(), ["βeta", ""]);
    }

    #[test]
    fn pointer_slice_truncation_keeps_storage_usable() {
        use glib::{collections::PtrSlice, GString};
        let mut values: PtrSlice<GString> = ["one", "two", "three"]
            .into_iter()
            .map(GString::from)
            .collect();
        values.truncate(1);
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].as_str(), "one");
        values.push(GString::from("four"));
        assert_eq!(values[1].as_str(), "four");
        values.truncate(0);
        values.push(GString::from("reused"));
        assert_eq!(values[0].as_str(), "reused");
    }

    #[test]
    fn object_and_value_copies_preserve_owned_references() {
        let object = glib::Object::new::<glib::Object>();
        let value = object.to_value();
        let copied = value.clone();
        drop(value);
        let restored = copied.get::<glib::Object>().unwrap();
        assert_eq!(restored, object);
        drop(object);
        assert!(restored.is::<glib::Object>());
    }

    #[derive(Clone, Debug, PartialEq, Eq, glib::Boxed)]
    #[boxed_type(name = "AtlasGlibRegressionBoxed")]
    struct OwnedBoxed(String);

    #[test]
    fn boxed_values_clone_and_drop_independently() {
        let value = OwnedBoxed("owned".into()).to_value();
        let copied = value.clone();
        drop(value);
        assert_eq!(
            copied.get::<OwnedBoxed>().unwrap(),
            OwnedBoxed("owned".into())
        );
    }

    #[test]
    fn ffi_outputs_respect_error_and_optional_pointer_branches() {
        let (path, hostname) = glib::filename_from_uri("file:///tmp/atlas-regression").unwrap();
        assert_eq!(path.to_str(), Some("/tmp/atlas-regression"));
        assert!(hostname.is_none());
        assert!(glib::filename_from_uri("invalid-uri").is_err());
        assert!(glib::uuid_string_is_valid(
            "550e8400-e29b-41d4-a716-446655440000"
        ));
        assert!(!glib::uuid_string_is_valid("invalid"));
    }
}
