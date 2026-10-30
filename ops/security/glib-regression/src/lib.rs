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
}
