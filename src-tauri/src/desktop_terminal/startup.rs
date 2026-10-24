/// Handles only the one ConPTY inherited-cursor query for a new blank terminal.
pub struct InitialCursor { active: bool, pending: Vec<u8> }
impl InitialCursor {
    pub fn new(active: bool) -> Self { Self { active, pending: Vec::new() } }
    pub fn push(&mut self, bytes: &[u8]) -> (bool, Vec<u8>) {
        if !self.active { return (false, bytes.to_vec()); }
        const QUERY: &[u8] = b"\x1b[6n";
        self.pending.extend_from_slice(bytes);
        if let Some(index) = self.pending.windows(QUERY.len()).position(|part| part == QUERY) {
            let mut output = self.pending[..index].to_vec();
            output.extend_from_slice(&self.pending[index + QUERY.len()..]);
            self.pending.clear(); self.active = false;
            return (true, output);
        }
        let retained = (1..QUERY.len()).rev().find(|&size| self.pending.ends_with(&QUERY[..size])).unwrap_or(0);
        let output = self.pending.drain(..self.pending.len() - retained).collect();
        (false, output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_initial_query_preserves_surrounding_bytes_and_later_queries() {
        let mut cursor = InitialCursor::new(true);
        assert_eq!(cursor.push(b"prefix\x1b["), (false, b"prefix".to_vec()));
        assert_eq!(cursor.push(b"6n\xe4\xb8"), (true, vec![0xe4, 0xb8]));
        assert_eq!(cursor.push(b"\x96\x1b[6n"), (false, b"\x96\x1b[6n".to_vec()));
        assert_eq!(InitialCursor::new(false).push(b"\x1b[6n"), (false, b"\x1b[6n".to_vec()));
    }
}
