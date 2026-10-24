/* Native API support probe only. Never linked into the Hub. */
#include <sys/types.h>
#include <sys/event.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static int registration(unsigned int note) {
    int queue = kqueue();
    if (queue < 0) { perror("kqueue"); exit(1); }
    struct kevent change, receipt;
    EV_SET(&change, getpid(), EVFILT_PROC, EV_ADD | EV_ENABLE | EV_RECEIPT,
           note, 0, NULL);
    int count = kevent(queue, &change, 1, &receipt, 1, NULL);
    int result = count < 0 ? errno :
        count == 1 && (receipt.flags & EV_ERROR) ? (int)receipt.data : -1;
    close(queue);
    return result;
}

int main(void) {
    int queue = kqueue();
    if (queue < 0) { perror("kqueue"); return 1; }
    struct kevent change, receipt;
    EV_SET(&change, getpid(), EVFILT_PROC, EV_ADD | EV_ENABLE | EV_RECEIPT,
           NOTE_FORK, 0, NULL);
    if (kevent(queue, &change, 1, &receipt, 1, NULL) != 1 ||
        !(receipt.flags & EV_ERROR) || receipt.data != 0) return 2;
    pid_t child = fork();
    if (child < 0) return 3;
    if (child == 0) {
        signal(SIGALRM, SIG_DFL);
        alarm(2);
        _exit(0);
    }
    struct timespec timeout = {2, 0};
    struct kevent event;
    int count = kevent(queue, NULL, 0, &event, 1, &timeout);
    int status = 0;
    if (waitpid(child, &status, 0) != child || !WIFEXITED(status)) return 4;
    if (count != 1 || !(event.fflags & NOTE_FORK)) return 5;
    close(queue);
    printf("{\"NOTE_EXIT_errno\":%d,\"NOTE_TRACK_errno\":%d,"
           "\"NOTE_TRACKERR_errno\":%d,\"NOTE_CHILD_errno\":%d,"
           "\"ENOTSUP\":%d,\"fork_event_data\":%lld,"
           "\"fork_event_ident\":%llu,\"watched_pid\":%d,"
           "\"child_pid\":%d,\"child_reaped\":true,"
           "\"SOL_LOCAL\":%d,\"LOCAL_PEERPID\":%d,\"EV_RECEIPT\":%d}\n",
           registration(NOTE_EXIT), registration(NOTE_TRACK),
           registration(NOTE_TRACKERR), registration(NOTE_CHILD), ENOTSUP,
           (long long)event.data, (unsigned long long)event.ident, getpid(),
           child, SOL_LOCAL, LOCAL_PEERPID, EV_RECEIPT);
    return 0;
}
